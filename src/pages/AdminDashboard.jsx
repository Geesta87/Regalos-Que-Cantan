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
    pendingOrders: 0
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
      // Check if auth is older than 24 hours
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
      
      // Calculate stats
      const totalSongs = data?.length || 0;
      const paidOrders = data?.filter(s => s.paid).length || 0;
      const pendingOrders = totalSongs - paidOrders;
      const totalRevenue = paidOrders * 19.99; // Assuming $19.99 per song

      setStats({
        totalSongs,
        totalRevenue,
        paidOrders,
        pendingOrders
      });

    } catch (err) {
      console.error('Error fetching songs:', err);
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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
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
      {/* Header */}
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
            <button
              onClick={fetchSongs}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
              title="Refrescar"
            >
              <span className="material-symbols-outlined text-gray-500">refresh</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors text-sm font-medium"
            >
              <span className="material-symbols-outlined text-lg">logout</span>
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Total Canciones</p>
                <p className="text-3xl font-bold text-[#171612] dark:text-white mt-1">{stats.totalSongs}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">music_note</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Ingresos Totales</p>
                <p className="text-3xl font-bold text-[#171612] dark:text-white mt-1">{formatCurrency(stats.totalRevenue)}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-green-600 dark:text-green-400">payments</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Pagados</p>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">{stats.paidOrders}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#2c3136] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Pendientes</p>
                <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">{stats.pendingOrders}</p>
              </div>
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">pending</span>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-[#2c3136] rounded-xl p-4 mb-6 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">search</span>
                <input
                  type="text"
                  placeholder="Buscar por nombre, email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[#171612] dark:text-white focus:ring-2 focus:ring-gold focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex gap-2">
              {['all', 'paid', 'pending'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setFilterStatus(filter)}
                  className={`px-4 py-3 rounded-lg font-medium transition-colors ${
                    filterStatus === filter
                      ? 'bg-gold text-forest'
                      : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                  }`}
                >
                  {filter === 'all' ? 'Todos' : filter === 'paid' ? 'Pagados' : 'Pendientes'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-6 py-4 rounded-xl mb-6">
            Error: {error}
          </div>
        )}

        {/* Songs Table */}
        <div className="bg-white dark:bg-[#2c3136] rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Para / De
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Género
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {filteredSongs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      No se encontraron canciones
                    </td>
                  </tr>
                ) : (
                  filteredSongs.map((song) => (
                    <tr key={song.id} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                        {formatDate(song.created_at)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-[#171612] dark:text-white">
                          {song.recipient_name}
                        </div>
                        <div className="text-xs text-gray-500">
                          de {song.sender_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {song.email}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 capitalize">
                        {song.genre}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                          song.paid 
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                        }`}>
                          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {song.paid ? 'check_circle' : 'pending'}
                          </span>
                          {song.paid ? 'Pagado' : 'Pendiente'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSelectedSong(song)}
                            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                            title="Ver detalles"
                          >
                            <span className="material-symbols-outlined text-gray-500">visibility</span>
                          </button>
                          {song.audio_url && (
                            <a
                              href={song.audio_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                              title="Escuchar canción"
                            >
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

        {/* Results count */}
        <div className="mt-4 text-sm text-gray-500 text-center">
          Mostrando {filteredSongs.length} de {songs.length} canciones
        </div>
      </main>

      {/* Song Detail Modal */}
      {selectedSong && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={() => setSelectedSong(null)}>
          <div className="bg-white dark:bg-[#2c3136] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="sticky top-0 bg-white dark:bg-[#2c3136] border-b border-gray-100 dark:border-white/5 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-[#171612] dark:text-white">Detalles de la Canción</h2>
              <button
                onClick={() => setSelectedSong(null)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                <span className="material-symbols-outlined text-gray-500">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-medium ${
                  selectedSong.paid 
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                }`}>
                  <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {selectedSong.paid ? 'check_circle' : 'pending'}
                  </span>
                  {selectedSong.paid ? 'Pagado - $19.99' : 'Pendiente de pago'}
                </span>
                <span className="text-sm text-gray-500">{formatDate(selectedSong.created_at)}</span>
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Para</p>
                  <p className="font-semibold text-[#171612] dark:text-white">{selectedSong.recipient_name}</p>
                </div>
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">De</p>
                  <p className="font-semibold text-[#171612] dark:text-white">{selectedSong.sender_name}</p>
                </div>
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Género</p>
                  <p className="font-semibold text-[#171612] dark:text-white capitalize">{selectedSong.genre}</p>
                </div>
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Ocasión</p>
                  <p className="font-semibold text-[#171612] dark:text-white capitalize">{selectedSong.occasion}</p>
                </div>
              </div>

              {/* Email & Relationship */}
              <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Email</p>
                <p className="font-semibold text-[#171612] dark:text-white">{selectedSong.email}</p>
                {selectedSong.relationship && (
                  <>
                    <p className="text-xs text-gray-500 mb-1 mt-3">Relación</p>
                    <p className="font-semibold text-[#171612] dark:text-white">{selectedSong.relationship}</p>
                  </>
                )}
              </div>

              {/* Details */}
              {selectedSong.details && (
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-1">Detalles proporcionados</p>
                  <p className="text-[#171612] dark:text-white text-sm whitespace-pre-wrap">{selectedSong.details}</p>
                </div>
              )}

              {/* Lyrics */}
              {selectedSong.lyrics && (
                <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-2">Letra generada</p>
                  <p className="text-[#171612] dark:text-white text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                    {selectedSong.lyrics}
                  </p>
                </div>
              )}

              {/* Audio Player */}
              {selectedSong.audio_url && (
                <div className="bg-gradient-to-br from-forest/10 to-forest/5 rounded-xl p-4">
                  <p className="text-xs text-gray-500 mb-3">Canción generada</p>
                  <audio controls className="w-full" src={selectedSong.audio_url}>
                    Tu navegador no soporta audio HTML5.
                  </audio>
                  <div className="flex gap-2 mt-3">
                    <a
                      href={selectedSong.audio_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 px-4 bg-gold text-forest rounded-lg font-medium text-center text-sm hover:brightness-110 transition-all flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-lg">download</span>
                      Descargar MP3
                    </a>
                  </div>
                </div>
              )}

              {/* Song ID */}
              <div className="text-center">
                <p className="text-xs text-gray-400 font-mono">ID: {selectedSong.id}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
