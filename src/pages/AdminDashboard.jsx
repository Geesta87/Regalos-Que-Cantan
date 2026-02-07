import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';
import { supabase } from '../services/api';
import { trackStep, FUNNEL_STEPS } from '../services/tracking';

export default function AdminDashboard() {
  const { navigateTo } = useContext(AppContext);
  const [songs, setSongs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedSong, setSelectedSong] = useState(null);
  const [activeTab, setActiveTab] = useState('orders');
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
  const [stats, setStats] = useState({
    totalSongs: 0,
    totalRevenue: 0,
    paidOrders: 0,
    pendingOrders: 0,
    freeOrders: 0,
    todayRevenue: 0,
    todayOrders: 0
  });

  // Check auth on mount
  useEffect(() => {
    const auth = localStorage.getItem('rqc_admin_auth');
    if (!auth) {
      navigateTo('adminLogin');
      return;
    }
    
    try {
      const authData = JSON.parse(auth);
      if (Date.now() - authData.timestamp > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('rqc_admin_auth');
        navigateTo('adminLogin');
        return;
      }
    } catch {
      navigateTo('adminLogin');
      return;
    }

    fetchSongs();
    fetchFunnelData();
    fetchEmailLogs();
    fetchEmailCampaigns();
    
    // Set up real-time subscription for emails
    const emailSubscription = supabase
      .channel('email_logs_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_logs' }, (payload) => {
        setEmailLogs(prev => [payload.new, ...prev]);
      })
      .subscribe();
    
    // Set up real-time subscription for campaigns
    const campaignSubscription = supabase
      .channel('email_campaigns_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'email_campaigns' }, (payload) => {
        setEmailCampaigns(prev => prev.map(c => c.id === payload.new.id ? payload.new : c));
      })
      .subscribe();
    
    return () => {
      emailSubscription.unsubscribe();
      campaignSubscription.unsubscribe();
    };
  }, [dateRange]);

  // ✅ ROBUST: Check if song is paid using multiple possible fields/formats
  const isPaid = (song) => {
    // Check boolean paid field
    if (song.paid === true) return true;
    if (song.paid === 'true') return true;
    if (song.paid === 1) return true;
    
    // Check is_paid field
    if (song.is_paid === true) return true;
    if (song.is_paid === 'true') return true;
    
    // Check payment_status field
    if (song.payment_status === 'paid') return true;
    if (song.payment_status === 'completed') return true;
    if (song.payment_status === 'succeeded') return true;
    
    // Check status field
    if (song.status === 'paid') return true;
    if (song.status === 'completed') return true;
    
    // Check if has stripe_payment_id (indicates successful payment)
    if (song.stripe_payment_id) return true;
    if (song.stripe_session_id && song.audio_url) return true;
    
    // Check amount_paid > 0
    if (song.amount_paid && parseFloat(song.amount_paid) > 0) return true;
    
    return false;
  };

  const fetchSongs = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

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

      setStats({ 
        totalSongs, 
        totalRevenue, 
        paidOrders, 
        pendingOrders, 
        freeOrders,
        todayRevenue,
        todayOrders
      });
    } catch (err) {
      console.error('Error fetching songs:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
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

      // Get a paid song for test data
      const testSong = songs.find(s => isPaid(s));
      if (!testSong) {
        alert('Necesitas al menos una orden pagada para probar');
        setSendingTestEmail(false);
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-purchase-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          songIds: [testSong.id],
          email: testEmail,
          isTest: true,
          campaignId: campaignId
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
    const buttonColor = campaign.button_color || '#d4af37';
    const bgColor = campaign.id === 'abandoned_24hr' ? '#e11d74' : '#d4af37';
    
    return `
      <!DOCTYPE html>
      <html>
      <body style="margin: 0; padding: 0; background-color: #0f1419; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #d4af37; font-size: 28px; margin: 0;">🎵 RegalosQueCantan</h1>
          </div>
          <div style="background: linear-gradient(135deg, #1a3a2f 0%, #0d2620 100%); border-radius: 20px; padding: 40px; text-align: center; border: 1px solid #d4af3730;">
            <h2 style="color: #ffffff; font-size: 28px; margin: 0 0 20px 0;">${campaign.heading || '¡Tu canción está lista!'}</h2>
            <p style="color: #ffffff; font-size: 16px; margin: 0 0 30px 0; line-height: 1.6;">
              ${(campaign.body_text || '').replace('{{recipient_name}}', '<strong style="color: #d4af37;">María</strong>')}
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
      'abandoned_1hr': '⏰ 1hr Recordatorio',
      'abandoned_24hr': '⚠️ 24hr Última oportunidad',
      'purchase_confirmation': '✅ Confirmación de Compra',
      'test': '🧪 Test'
    };
    return labels[type] || type;
  };

  const getEmailTypeColor = (type) => {
    const colors = {
      'abandoned_1hr': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      'abandoned_24hr': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      'purchase_confirmation': 'bg-green-500/20 text-green-400 border-green-500/30',
      'test': 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    };
    return colors[type] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  // Email Preview Templates
  const get1hrEmailPreview = () => `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #1a3a2f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #2d5a4a 0%, #1a3a2f 100%); border-radius: 20px; padding: 40px; text-align: center;">
          <h1 style="color: #d4af37; font-size: 28px; margin: 0 0 20px 0;">🎵 ¡Tu canción está lista!</h1>
          <p style="color: #ffffff; font-size: 18px; margin: 0 0 30px 0;">
            La canción personalizada para <strong style="color: #d4af37;">María</strong> está esperándote.
          </p>
          <a href="#" style="display: inline-block; background: #d4af37; color: #1a3a2f; text-decoration: none; padding: 16px 40px; border-radius: 30px; font-weight: bold; font-size: 16px;">
            Escuchar y Descargar
          </a>
          <p style="color: #ffffff80; font-size: 14px; margin: 30px 0 0 0;">
            ¿No solicitaste esta canción? Ignora este correo.
          </p>
        </div>
        <p style="color: #ffffff40; font-size: 12px; text-align: center; margin-top: 20px;">
          RegalosQueCantan © 2026
        </p>
      </div>
    </body>
    </html>
  `;

  const get24hrEmailPreview = () => `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #1a3a2f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #2d5a4a 0%, #1a3a2f 100%); border-radius: 20px; padding: 40px; text-align: center;">
          <h1 style="color: #e11d74; font-size: 28px; margin: 0 0 20px 0;">⏰ Última oportunidad</h1>
          <p style="color: #ffffff; font-size: 18px; margin: 0 0 20px 0;">
            Tu canción personalizada para <strong style="color: #d4af37;">María</strong> sigue esperando.
          </p>
          <p style="color: #ffffff80; font-size: 14px; margin: 0 0 30px 0;">
            No dejes pasar este regalo único. La canción se eliminará pronto si no se completa la compra.
          </p>
          <a href="#" style="display: inline-block; background: #e11d74; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 30px; font-weight: bold; font-size: 16px;">
            Completar mi Compra
          </a>
          <p style="color: #ffffff80; font-size: 14px; margin: 30px 0 0 0;">
            ¿Tienes preguntas? Responde a este correo.
          </p>
        </div>
        <p style="color: #ffffff40; font-size: 12px; text-align: center; margin-top: 20px;">
          RegalosQueCantan © 2026
        </p>
      </div>
    </body>
    </html>
  `;

  const getPurchaseEmailPreview = () => `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; background-color: #0f1419; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #d4af37; font-size: 32px; margin: 0;">🎵 RegalosQueCantan</h1>
        </div>
        <div style="background: linear-gradient(135deg, #1a3a2f 0%, #0d2620 100%); border-radius: 20px; padding: 40px; text-align: center; border: 1px solid #d4af3730;">
          <div style="font-size: 60px; margin-bottom: 20px;">🎉</div>
          <h2 style="color: #ffffff; font-size: 24px; margin: 0 0 10px 0;">¡Gracias por tu compra!</h2>
          <p style="color: #d4af37; font-size: 20px; margin: 0 0 30px 0;">
            Tu canción para <strong>María</strong> está lista
          </p>
          <div style="background: #ffffff10; border-radius: 12px; padding: 20px; margin-bottom: 30px; text-align: left;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="color: #ffffff80; padding: 8px 0; font-size: 14px;">Para:</td>
                <td style="color: #ffffff; padding: 8px 0; font-size: 14px; text-align: right;"><strong>María</strong></td>
              </tr>
              <tr>
                <td style="color: #ffffff80; padding: 8px 0; font-size: 14px;">De:</td>
                <td style="color: #ffffff; padding: 8px 0; font-size: 14px; text-align: right;">Carlos</td>
              </tr>
              <tr>
                <td style="color: #ffffff80; padding: 8px 0; font-size: 14px;">Género:</td>
                <td style="color: #d4af37; padding: 8px 0; font-size: 14px; text-align: right;">Balada Romántica</td>
              </tr>
              <tr>
                <td style="color: #ffffff80; padding: 8px 0; font-size: 14px;">Ocasión:</td>
                <td style="color: #ffffff; padding: 8px 0; font-size: 14px; text-align: right;">San Valentín</td>
              </tr>
            </table>
          </div>
          <a href="#" style="display: inline-block; background: linear-gradient(135deg, #d4af37 0%, #b8962e 100%); color: #0f1419; text-decoration: none; padding: 18px 50px; border-radius: 30px; font-weight: bold; font-size: 18px; box-shadow: 0 4px 15px #d4af3750;">
            🎧 Escuchar y Descargar
          </a>
          <p style="color: #ffffff60; font-size: 14px; margin: 30px 0 0 0;">
            Este enlace es permanente. Puedes descargar tu canción cuando quieras.
          </p>
        </div>
        <div style="background: #1a1f26; border-radius: 16px; padding: 25px; margin-top: 20px; border: 1px solid #ffffff10;">
          <h3 style="color: #ffffff; font-size: 16px; margin: 0 0 15px 0;">💡 ¿Cómo compartir tu canción?</h3>
          <ul style="color: #ffffff80; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>Descarga el MP3 y envíalo por WhatsApp</li>
            <li>Comparte el enlace directamente</li>
            <li>Ponla en una bocina durante una celebración</li>
          </ul>
        </div>
        <div style="text-align: center; margin-top: 30px;">
          <p style="color: #ffffff40; font-size: 12px; margin: 0;">
            ¿Preguntas? Responde a este correo o escríbenos a hola@regalosquecantan.com
          </p>
          <p style="color: #ffffff30; font-size: 11px; margin: 15px 0 0 0;">
            RegalosQueCantan © 2026 | El regalo que nunca olvidarán
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const handleLogout = () => {
    localStorage.removeItem('rqc_admin_auth');
    window.location.href = '/';
  };

  const filteredSongs = songs.filter(song => {
    const matchesSearch = 
      song.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      song.sender_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      song.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = 
      filterStatus === 'all' ||
      (filterStatus === 'paid' && isPaid(song)) ||
      (filterStatus === 'pending' && !isPaid(song));
    return matchesSearch && matchesFilter;
  });

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
    if (song.is_bundle) return 29.99;
    return 19.99;
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
              onClick={fetchSongs}
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
            <p className="text-3xl font-bold">{formatCurrency(stats.totalRevenue)}</p>
            <p className="text-sm text-gray-400">{stats.freeOrders > 0 && `${stats.freeOrders} gratis`}</p>
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
                <p className="text-2xl font-bold text-green-400">{formatCurrency(stats.todayRevenue)}</p>
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
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-right">Monto</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Estado</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Descarga</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredSongs.length === 0 ? (
                      <tr>
                        <td colSpan="9" className="px-4 py-12 text-center text-gray-500">
                          No se encontraron órdenes
                        </td>
                      </tr>
                    ) : (
                      filteredSongs.map((song) => (
                        <tr key={song.id} className="hover:bg-white/5 transition">
                          <td className="px-4 py-3">
                            <span className="text-sm text-gray-300">{formatDate(song.created_at)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium text-white">{song.recipient_name || '—'}</p>
                              <p className="text-xs text-gray-500">de {song.sender_name || '—'}</p>
                              <p className="text-xs text-gray-500 truncate max-w-[180px]">{song.email}</p>
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
                          <td className="px-4 py-3 text-right">
                            {isPaid(song) ? (
                              <span className="font-semibold text-green-400">
                                {formatCurrency(getSongPrice(song))}
                              </span>
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
                                onClick={() => setSelectedSong(song)} 
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
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 bg-white/5 text-center">
                <span className="text-sm text-gray-500">
                  Mostrando {filteredSongs.length} de {songs.length} órdenes
                </span>
              </div>
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
          /* Emails Tab - Clean & Simple */
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
                  emailCampaigns.map((campaign) => (
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
                          
                          {/* Stats */}
                          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                            <span>📧 {emailLogs.filter(e => e.email_type === campaign.id).length} enviados</span>
                            {campaign.delay_hours > 0 && (
                              <span>⏱️ Se envía a las {campaign.delay_hours}h</span>
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
                  ))
                )}
              </div>
            </div>
            
            {/* Section 2: Email History */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">📨 Historial de Emails</h2>
                <span className="text-sm text-gray-500">{emailLogs.length} emails enviados</span>
              </div>
              
              <div className="bg-[#1a1f26] rounded-2xl overflow-hidden border border-white/5">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white/5 text-left text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Para</th>
                      <th className="px-4 py-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {emailLogs.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                          No hay emails enviados todavía
                        </td>
                      </tr>
                    ) : (
                      emailLogs.slice(0, 20).map((log) => (
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
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {emailLogs.length > 20 && (
                  <div className="px-4 py-3 bg-white/5 text-center">
                    <span className="text-sm text-gray-500">Mostrando últimos 20 de {emailLogs.length}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

      {/* Edit Campaign Modal */}
      {editingCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1a1f26] rounded-2xl max-w-lg w-full p-6 border border-white/10">
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
                    ✓ Pagado — {formatCurrency(getSongPrice(selectedSong))}
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
              
              {/* Customer Link */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                <p className="text-xs text-blue-400 mb-2">🔗 Link del cliente</p>
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
                      alert('Link copiado!');
                    }}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-400 transition"
                  >
                    Copiar
                  </button>
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
