import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';
import { supabase } from '../services/api';

export default function AdminDashboard() {
  const { navigateTo } = useContext(AppContext);
  const [songs, setSongs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedSong, setSelectedSong] = useState(null);
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
  }, []);

  const fetchSongs = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setSongs(data || []);
      
      // ✅ FIX: Calculate stats properly using actual amount_paid
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

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#1a1d21]">
      <header className="bg-white dark:bg-[#2c3136] shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-gold/20 to-gold/10 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-gold">admin_panel_settings</span>
            </div>
            <div>
              <h1 className="font-bold text-[#171612] dark:text-white">Admin Dashboard</h1>
              <p className="text-xs text-gray-500">RegalosQueCantan</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={fetchSongs} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5" title="Refrescar">
              <span className="material-symbols-outlined text-gray-500">refresh</span>
            </button>
            <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm font-medium">
              <span className="material-symbols-outlined text-lg">logout</span>Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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

        <div className="bg-white dark:bg-[#2c3136] rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/5">
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Para / De</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Género</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Ocasión</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Voz</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Monto</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Estado</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Descargado</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {filteredSongs.length === 0 ? (
                  <tr><td colSpan="10" className="px-6 py-12 text-center text-gray-500">No se encontraron canciones</td></tr>
                ) : (
                  filteredSongs.map((song) => (
                    <tr key={song.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                      <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-300">{formatDate(song.created_at)}</td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-medium text-[#171612] dark:text-white">{song.recipient_name}</div>
                        <div className="text-xs text-gray-500">de {song.sender_name}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-300">{song.email}</td>
                      <td className="px-4 py-4">
                        <div className="text-sm text-gray-600 dark:text-gray-300 capitalize">{song.genre}</div>
                        {song.sub_genre && <div className="text-xs text-gray-400">{song.sub_genre}</div>}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-300 capitalize">{song.occasion || '-'}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${song.voice_type === 'female' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'}`}>
                          {song.voice_type === 'female' ? '♀ Fem' : '♂ Masc'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm font-medium text-gray-600 dark:text-gray-300">
                        {song.paid ? formatCurrency(getSongPrice(song)) : '-'}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${song.paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {song.paid ? '✓ Pagado' : '⏳ Pendiente'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {song.paid ? (
                          song.downloaded ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              ✓ Sí {song.download_count > 1 ? `(${song.download_count}x)` : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                              ✗ No
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setSelectedSong(song)} className="p-2 rounded-lg hover:bg-gray-100" title="Ver detalles">
                            <span className="material-symbols-outlined text-gray-500">visibility</span>
                          </button>
                          {song.audio_url && (
                            <>
                              <a href={song.audio_url} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg hover:bg-gray-100" title="Reproducir">
                                <span className="material-symbols-outlined text-gold">play_circle</span>
                              </a>
                              <a href={song.audio_url} download className="p-2 rounded-lg hover:bg-gray-100" title="Descargar">
                                <span className="material-symbols-outlined text-blue-500">download</span>
                              </a>
                            </>
                          )}
                          <button 
                            onClick={() => {
                              const link = `${window.location.origin}/preview?song=${song.id}`;
                              navigator.clipboard.writeText(link);
                              alert('Link copiado!');
                            }} 
                            className="p-2 rounded-lg hover:bg-gray-100" 
                            title="Copiar link"
                          >
                            <span className="material-symbols-outlined text-gray-400">link</span>
                          </button>
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
      </main>

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
              
              {/* Download Status */}
              {selectedSong.paid && (
                <div className={`rounded-xl p-4 ${selectedSong.downloaded ? 'bg-green-50' : 'bg-amber-50'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-xl" style={{ color: selectedSong.downloaded ? '#16a34a' : '#d97706' }}>
                        {selectedSong.downloaded ? 'download_done' : 'pending'}
                      </span>
                      <div>
                        <p className="font-medium" style={{ color: selectedSong.downloaded ? '#16a34a' : '#d97706' }}>
                          {selectedSong.downloaded ? 'Descargado' : 'No descargado aún'}
                        </p>
                        {selectedSong.downloaded && (
                          <p className="text-xs text-gray-500">
                            {selectedSong.download_count || 1} {selectedSong.download_count === 1 ? 'vez' : 'veces'}
                            {selectedSong.last_downloaded_at && ` • Última: ${formatDate(selectedSong.last_downloaded_at)}`}
                          </p>
                        )}
                      </div>
                    </div>
                    {!selectedSong.downloaded && selectedSong.audio_url && (
                      <span className="text-xs text-amber-600">⚠️ Cliente no ha descargado</span>
                    )}
                  </div>
                </div>
              )}
              
              {selectedSong.coupon_code && (
                <div className="bg-purple-100 rounded-xl p-4">
                  <p className="text-xs text-purple-600">Cupón: <strong>{selectedSong.coupon_code}</strong></p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Para</p><p className="font-semibold">{selectedSong.recipient_name}</p></div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">De</p><p className="font-semibold">{selectedSong.sender_name}</p></div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-500">Género</p>
                  <p className="font-semibold capitalize">{selectedSong.genre}</p>
                  {selectedSong.sub_genre && <p className="text-xs text-gray-400 mt-1">{selectedSong.sub_genre}</p>}
                </div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Ocasión</p><p className="font-semibold capitalize">{selectedSong.occasion || 'No especificada'}</p></div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-500">Voz</p>
                  <p className="font-semibold">
                    {selectedSong.voice_type === 'female' ? '♀ Femenina' : '♂ Masculina'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Relación</p><p className="font-semibold capitalize">{selectedSong.relationship || 'No especificada'}</p></div>
              </div>
              
              <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Email</p><p className="font-semibold">{selectedSong.email}</p></div>
              
              {selectedSong.details && <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500">Detalles</p><p className="text-sm whitespace-pre-wrap">{selectedSong.details}</p></div>}
              
              {selectedSong.lyrics && <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500 mb-2">Letra</p><p className="text-sm whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">{selectedSong.lyrics}</p></div>}
              
              {selectedSong.audio_url && (
                <div className="bg-forest/10 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-2">Audio</p>
                  <audio controls className="w-full" src={selectedSong.audio_url} />
                  <div className="flex gap-2 mt-3">
                    <a href={selectedSong.audio_url} download className="flex-1 py-2 px-4 bg-gold text-forest rounded-lg font-medium text-center text-sm hover:brightness-110">
                      ⬇️ Descargar MP3
                    </a>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(selectedSong.audio_url);
                        alert('URL copiada!');
                      }}
                      className="py-2 px-4 bg-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-300"
                    >
                      📋 Copiar URL
                    </button>
                  </div>
                </div>
              )}
              
              {/* Customer Link */}
              <div className="bg-blue-50 rounded-xl p-4">
                <p className="text-xs text-blue-600 mb-2">Link del cliente</p>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    readOnly 
                    value={`${window.location.origin}/preview?song=${selectedSong.id}`}
                    className="flex-1 px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm"
                  />
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/preview?song=${selectedSong.id}`);
                      alert('Link copiado!');
                    }}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600"
                  >
                    Copiar
                  </button>
                </div>
              </div>
              
              <p className="text-center text-xs text-gray-400 font-mono">ID: {selectedSong.id}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
