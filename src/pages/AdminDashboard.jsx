import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';
import { supabase } from '../services/api';
import { FUNNEL_STEPS } from '../services/tracking';

export default function AdminDashboard() {
  const { navigateTo } = useContext(AppContext);
  const [songs, setSongs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedSong, setSelectedSong] = useState(null);
  const [activeTab, setActiveTab] = useState('orders'); // 'orders' | 'funnel'
  const [funnelData, setFunnelData] = useState([]);
  const [funnelPeriod, setFunnelPeriod] = useState('7'); // days
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [stats, setStats] = useState({
    totalSongs: 0,
    totalRevenue: 0,
    paidOrders: 0,
    pendingOrders: 0,
    freeOrders: 0,
    bundleOrders: 0
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
  }, []);

  // Refetch funnel data when period changes
  useEffect(() => {
    if (activeTab === 'funnel') {
      fetchFunnelData();
    }
  }, [funnelPeriod, activeTab]);

  const fetchFunnelData = async () => {
    setFunnelLoading(true);
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(funnelPeriod));
      
      const { data, error } = await supabase
        .from('funnel_events')
        .select('step, session_id, created_at, utm_source, utm_campaign, device_type')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Aggregate by step
      const stepCounts = {};
      const uniqueSessions = new Set();
      const utmSources = {};
      const devices = {};

      data?.forEach(event => {
        // Count steps
        if (!stepCounts[event.step]) {
          stepCounts[event.step] = { total: 0, sessions: new Set() };
        }
        stepCounts[event.step].total++;
        stepCounts[event.step].sessions.add(event.session_id);
        uniqueSessions.add(event.session_id);

        // Track UTM sources
        if (event.utm_source) {
          utmSources[event.utm_source] = (utmSources[event.utm_source] || 0) + 1;
        }

        // Track devices
        if (event.device_type) {
          devices[event.device_type] = (devices[event.device_type] || 0) + 1;
        }
      });

      // Build funnel array
      const landingCount = stepCounts['landing']?.sessions.size || 0;
      const funnelArray = FUNNEL_STEPS.map(step => {
        const count = stepCounts[step.key]?.sessions.size || 0;
        const conversionRate = landingCount > 0 ? ((count / landingCount) * 100).toFixed(1) : 0;
        return {
          ...step,
          count,
          conversionRate,
          total: stepCounts[step.key]?.total || 0
        };
      });

      setFunnelData({
        steps: funnelArray,
        totalSessions: uniqueSessions.size,
        utmSources: Object.entries(utmSources).sort((a, b) => b[1] - a[1]).slice(0, 5),
        devices,
        rawEvents: data?.length || 0
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error fetching funnel:', err);
    } finally {
      setFunnelLoading(false);
    }
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
      
      // Calculate stats properly using actual amount_paid
      const totalSongs = data?.length || 0;
      const paidSongs = data?.filter(s => s.paid) || [];
      const paidOrders = paidSongs.length;
      const pendingOrders = totalSongs - paidOrders;
      
      let totalRevenue = 0;
      let freeOrders = 0;
      let bundleOrders = 0;
      
      const sessionGroups = {};
      paidSongs.forEach(song => {
        if (song.amount_paid !== undefined && song.amount_paid !== null) {
          totalRevenue += parseFloat(song.amount_paid) || 0;
          if (parseFloat(song.amount_paid) === 0) freeOrders++;
        } else {
          const sessionId = song.session_id || song.id;
          if (!sessionGroups[sessionId]) {
            sessionGroups[sessionId] = [];
          }
          sessionGroups[sessionId].push(song);
        }
      });
      
      Object.values(sessionGroups).forEach(group => {
        if (group.length >= 2) {
          totalRevenue += 29.99;
          bundleOrders++;
        } else if (group.length === 1) {
          const song = group[0];
          if (song.coupon_code === 'GRATIS100' || song.is_free) {
            freeOrders++;
          } else {
            totalRevenue += 19.99;
          }
        }
      });

      setStats({ totalSongs, totalRevenue, paidOrders, pendingOrders, freeOrders, bundleOrders });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error fetching songs:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

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
      (filterStatus === 'paid' && song.paid) ||
      (filterStatus === 'pending' && !song.paid);
    return matchesSearch && matchesFilter;
  });

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('es-MX', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const getSongPrice = (song) => {
    if (song.amount_paid !== undefined && song.amount_paid !== null) return parseFloat(song.amount_paid);
    if (song.coupon_code === 'GRATIS100' || song.is_free) return 0;
    if (song.is_bundle) return 29.99;
    return 19.99;
  };

  // Calculate drop-off between steps
  const getDropOff = (currentIndex) => {
    if (!funnelData.steps || currentIndex === 0) return null;
    const current = funnelData.steps[currentIndex]?.count || 0;
    const previous = funnelData.steps[currentIndex - 1]?.count || 0;
    if (previous === 0) return null;
    const dropOff = ((previous - current) / previous * 100).toFixed(0);
    return dropOff;
  };

  // Find biggest drop-off
  const getBiggestDropOff = () => {
    if (!funnelData.steps || funnelData.steps.length < 2) return null;
    let maxDrop = 0;
    let maxDropIndex = 0;
    
    for (let i = 1; i < funnelData.steps.length; i++) {
      const prev = funnelData.steps[i - 1]?.count || 0;
      const curr = funnelData.steps[i]?.count || 0;
      if (prev > 0) {
        const drop = (prev - curr) / prev * 100;
        if (drop > maxDrop) {
          maxDrop = drop;
          maxDropIndex = i;
        }
      }
    }
    
    if (maxDrop > 0) {
      return {
        from: funnelData.steps[maxDropIndex - 1]?.label,
        to: funnelData.steps[maxDropIndex]?.label,
        percentage: maxDrop.toFixed(0)
      };
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-[#1a1d21] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Cargando datos...</p>
        </div>
      </div>
    );
  }

  const biggestDropOff = getBiggestDropOff();

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#1a1d21]">
      {/* Header */}
      <header className="bg-white dark:bg-[#2c3136] shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-gold/20 to-gold/10 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-gold">admin_panel_settings</span>
            </div>
            <div>
              <h1 className="font-bold text-[#171612] dark:text-white text-lg">RQC Admin</h1>
              <p className="text-xs text-gray-500">Panel de Control</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={fetchSongs} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5" title="Actualizar">
              <span className="material-symbols-outlined text-gray-500">refresh</span>
            </button>
            <button onClick={handleLogout} className="px-4 py-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 text-sm font-medium hover:bg-red-200">
              Cerrar Sesión
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-6 py-3 rounded-xl font-semibold transition-all ${
              activeTab === 'orders'
                ? 'bg-gold text-forest shadow-lg'
                : 'bg-white dark:bg-[#2c3136] text-gray-600 dark:text-gray-300 hover:bg-gray-50'
            }`}
          >
            <span className="material-symbols-outlined text-sm mr-2 align-middle">receipt_long</span>
            Órdenes
          </button>
          <button
            onClick={() => setActiveTab('funnel')}
            className={`px-6 py-3 rounded-xl font-semibold transition-all ${
              activeTab === 'funnel'
                ? 'bg-gold text-forest shadow-lg'
                : 'bg-white dark:bg-[#2c3136] text-gray-600 dark:text-gray-300 hover:bg-gray-50'
            }`}
          >
            <span className="material-symbols-outlined text-sm mr-2 align-middle">filter_alt</span>
            Funnel Analytics
          </button>
        </div>

        {/* Stats Row - Always visible */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm">Total Canciones</p>
                <p className="text-3xl font-bold text-[#171612] dark:text-white mt-1">{stats.totalSongs}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-blue-600">music_note</span>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm">Ingresos Totales</p>
                <p className="text-3xl font-bold text-[#171612] dark:text-white mt-1">{formatCurrency(stats.totalRevenue)}</p>
                {stats.freeOrders > 0 && <p className="text-xs text-gray-400 mt-1">{stats.freeOrders} gratis</p>}
              </div>
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-green-600">payments</span>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm">Órdenes Pagadas</p>
                <p className="text-3xl font-bold text-[#171612] dark:text-white mt-1">{stats.paidOrders}</p>
              </div>
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-emerald-600">check_circle</span>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm">Pendientes</p>
                <p className="text-3xl font-bold text-[#171612] dark:text-white mt-1">{stats.pendingOrders}</p>
              </div>
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-amber-600">pending</span>
              </div>
            </div>
          </div>
        </div>

        {/* FUNNEL TAB */}
        {activeTab === 'funnel' && (
          <div className="space-y-6">
            {/* Funnel Controls */}
            <div className="bg-white dark:bg-[#2c3136] rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-sm">Período:</span>
                {['1', '7', '14', '30'].map((days) => (
                  <button
                    key={days}
                    onClick={() => setFunnelPeriod(days)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      funnelPeriod === days
                        ? 'bg-gold text-forest'
                        : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                    }`}
                  >
                    {days === '1' ? 'Hoy' : `${days} días`}
                  </button>
                ))}
              </div>
              <button
                onClick={fetchFunnelData}
                disabled={funnelLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 text-sm"
              >
                <span className={`material-symbols-outlined text-sm ${funnelLoading ? 'animate-spin' : ''}`}>refresh</span>
                Actualizar
              </button>
            </div>

            {/* Funnel Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-[#2c3136] rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <span className="material-symbols-outlined text-blue-600">group</span>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Sesiones Únicas</p>
                    <p className="text-2xl font-bold text-[#171612] dark:text-white">{funnelData.totalSessions || 0}</p>
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-[#2c3136] rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                    <span className="material-symbols-outlined text-green-600">trending_up</span>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Conversión Total</p>
                    <p className="text-2xl font-bold text-[#171612] dark:text-white">
                      {funnelData.steps?.find(s => s.key === 'purchase')?.conversionRate || 0}%
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-[#2c3136] rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                    <span className="material-symbols-outlined text-red-600">trending_down</span>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Mayor Drop-off</p>
                    <p className="text-lg font-bold text-[#171612] dark:text-white">
                      {biggestDropOff ? `${biggestDropOff.from} → ${biggestDropOff.to}` : 'N/A'}
                    </p>
                    {biggestDropOff && (
                      <p className="text-xs text-red-500">-{biggestDropOff.percentage}% perdido</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Funnel Visualization */}
            <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-[#171612] dark:text-white mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-gold">filter_alt</span>
                Funnel de Conversión
              </h3>
              
              {funnelLoading ? (
                <div className="text-center py-12">
                  <div className="w-8 h-8 border-4 border-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-gray-500">Cargando datos...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {funnelData.steps?.map((step, index) => {
                    const dropOff = getDropOff(index);
                    const barWidth = step.conversionRate > 0 ? Math.max(step.conversionRate, 5) : 0;
                    
                    return (
                      <div key={step.key}>
                        <div className="flex items-center gap-4">
                          <div className="w-24 text-right">
                            <span className="text-sm text-gray-500">{step.icon} {step.label}</span>
                          </div>
                          <div className="flex-1 relative">
                            <div className="h-10 bg-gray-100 dark:bg-white/5 rounded-lg overflow-hidden">
                              <div
                                className={`h-full rounded-lg transition-all duration-500 flex items-center px-3 ${
                                  step.key === 'purchase' 
                                    ? 'bg-green-500' 
                                    : index < 3 
                                      ? 'bg-gold' 
                                      : 'bg-blue-500'
                                }`}
                                style={{ width: `${barWidth}%` }}
                              >
                                <span className="text-white text-sm font-bold whitespace-nowrap">
                                  {step.count} ({step.conversionRate}%)
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="w-16 text-right">
                            {dropOff && parseInt(dropOff) > 0 && (
                              <span className="text-xs text-red-500 font-medium">-{dropOff}%</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Traffic Sources & Devices */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* UTM Sources */}
              <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
                <h3 className="text-md font-bold text-[#171612] dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-gold text-lg">campaign</span>
                  Fuentes de Tráfico
                </h3>
                {funnelData.utmSources?.length > 0 ? (
                  <div className="space-y-3">
                    {funnelData.utmSources.map(([source, count]) => (
                      <div key={source} className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 dark:text-gray-300 capitalize">{source}</span>
                        <span className="text-sm font-bold text-[#171612] dark:text-white">{count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No hay datos de UTM</p>
                )}
              </div>

              {/* Devices */}
              <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
                <h3 className="text-md font-bold text-[#171612] dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-gold text-lg">devices</span>
                  Dispositivos
                </h3>
                {funnelData.devices && Object.keys(funnelData.devices).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(funnelData.devices).map(([device, count]) => (
                      <div key={device} className="flex items-center justify-between">
                        <span className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm">
                            {device === 'mobile' ? 'smartphone' : device === 'tablet' ? 'tablet' : 'computer'}
                          </span>
                          {device === 'mobile' ? 'Móvil' : device === 'tablet' ? 'Tablet' : 'Desktop'}
                        </span>
                        <span className="text-sm font-bold text-[#171612] dark:text-white">{count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No hay datos</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ORDERS TAB */}
        {activeTab === 'orders' && (
          <>
            {/* Search and Filter */}
            <div className="bg-white dark:bg-[#2c3136] rounded-xl p-4 shadow-sm mb-6 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-400">search</span>
                  <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/5 text-[#171612] dark:text-white" />
                </div>
              </div>
              <div className="flex gap-2">
                {['all', 'paid', 'pending'].map((status) => (
                  <button key={status} onClick={() => setFilterStatus(status)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${filterStatus === status ? 'bg-gold text-forest' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300'}`}>
                    {status === 'all' ? 'Todos' : status === 'paid' ? 'Pagados' : 'Pendientes'}
                  </button>
                ))}
              </div>
            </div>

            {/* Orders Table */}
            <div className="bg-white dark:bg-[#2c3136] rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-white/5">
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Para / De</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Género</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Estado</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {filteredSongs.length === 0 ? (
                      <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-500">No se encontraron canciones</td></tr>
                    ) : (
                      filteredSongs.map((song) => (
                        <tr key={song.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                          <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{formatDate(song.created_at)}</td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-medium text-[#171612] dark:text-white">{song.recipient_name}</div>
                            <div className="text-xs text-gray-500">de {song.sender_name}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{song.email}</td>
                          <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 capitalize">{song.genre}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${song.paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {song.paid ? '✓ Pagado' : '⏳ Pendiente'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <button onClick={() => setSelectedSong(song)} className="p-2 rounded-lg hover:bg-gray-100" title="Ver">
                                <span className="material-symbols-outlined text-gray-500">visibility</span>
                              </button>
                              {song.audio_url && (
                                <a href={song.audio_url} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg hover:bg-gray-100">
                                  <span className="material-symbols-outlined text-gold">play_circle</span>
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-4 text-sm text-gray-500 text-center">Mostrando {filteredSongs.length} de {songs.length} canciones</div>
          </>
        )}
      </main>

      {/* Song Detail Modal */}
      {selectedSong && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={() => setSelectedSong(null)}>
          <div className="bg-white dark:bg-[#2c3136] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white dark:bg-[#2c3136] border-b px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Detalles de la Canción</h2>
              <button onClick={() => setSelectedSong(null)} className="p-2 rounded-lg hover:bg-gray-100">
                <span className="material-symbols-outlined text-gray-500">close</span>
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <span className={`px-4 py-2 rounded-full font-medium ${selectedSong.paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {selectedSong.paid ? `✓ Pagado - ${formatCurrency(getSongPrice(selectedSong))}` : '⏳ Pendiente'}
                </span>
                <span className="text-sm text-gray-500">{formatDate(selectedSong.created_at)}</span>
              </div>
              {selectedSong.coupon_code && (
                <div className="bg-purple-100 rounded-xl p-4">
                  <p className="text-xs text-purple-600">Cupón: <strong>{selectedSong.coupon_code}</strong></p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Para</p><p className="font-semibold">{selectedSong.recipient_name}</p></div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">De</p><p className="font-semibold">{selectedSong.sender_name}</p></div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Género</p><p className="font-semibold capitalize">{selectedSong.genre}</p></div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Ocasión</p><p className="font-semibold capitalize">{selectedSong.occasion}</p></div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Email</p><p className="font-semibold">{selectedSong.email}</p></div>
              {selectedSong.details && <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Detalles</p><p className="text-sm whitespace-pre-wrap">{selectedSong.details}</p></div>}
              {selectedSong.lyrics && <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500 mb-2">Letra</p><p className="text-sm whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">{selectedSong.lyrics}</p></div>}
              {selectedSong.audio_url && (
                <div className="bg-forest/10 rounded-xl p-4">
                  <audio controls className="w-full" src={selectedSong.audio_url} />
                  <a href={selectedSong.audio_url} target="_blank" rel="noopener noreferrer" className="block mt-3 py-2 px-4 bg-gold text-forest rounded-lg font-medium text-center text-sm">Descargar MP3</a>
                </div>
              )}
              <p className="text-center text-xs text-gray-400 font-mono">ID: {selectedSong.id}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
