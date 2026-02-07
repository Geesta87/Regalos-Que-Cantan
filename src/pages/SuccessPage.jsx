import React, { useState, useRef, useEffect } from 'react';
import { checkSongStatus } from '../services/api';
import { trackStep } from '../services/tracking';

export default function SuccessPage() {
  const [songs, setSongs] = useState([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(null);
  
  const audioRef = useRef(null);

  // ✅ FIX: Helper function to safely get field with camelCase/snake_case fallback
  const getField = (obj, camelCase, snakeCase, fallback = '') => {
    return obj?.[camelCase] || obj?.[snakeCase] || fallback;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    
    // Support both song_ids (comma-separated) and song_id (single)
    const songIdsParam = params.get('song_ids');
    const singleSongId = params.get('song_id');
    
    let songIds = [];
    
    if (songIdsParam) {
      songIds = songIdsParam.split(',').filter(id => id.trim());
    } else if (singleSongId) {
      songIds = [singleSongId];
    }
    
    // ✅ FIX: Wrapped in DEV check
    if (import.meta.env.DEV) {
      console.log('SuccessPage - song IDs:', songIds);
    }
    
    if (songIds.length > 0) {
      fetchSongs(songIds);
      
      // Track purchase event
      trackStep('purchase', {
        song_ids: songIds,
        num_songs: songIds.length
      });
    } else {
      setError('No se encontró el ID de la canción en la URL');
      setLoading(false);
    }
  }, []);

  const fetchSongs = async (songIds) => {
    try {
      setLoading(true);
      
      // Fetch all songs
      const fetchedSongs = [];
      
      for (const songId of songIds) {
        try {
          const result = await checkSongStatus(songId);
          if (import.meta.env.DEV) {
            console.log('Fetched song:', result);
          }
          
          if (result.song) {
            fetchedSongs.push(result.song);
          }
        } catch (err) {
          if (import.meta.env.DEV) {
            console.error('Error fetching song:', songId, err);
          }
        }
      }
      
      if (fetchedSongs.length > 0) {
        // Sort by version if available
        fetchedSongs.sort((a, b) => (a.version || 1) - (b.version || 1));
        setSongs(fetchedSongs);
      } else {
        setError('No se pudieron cargar las canciones');
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Fetch error:', err);
      }
      setError('Error al cargar las canciones: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const currentSong = songs[currentSongIndex];

  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => {
        if (import.meta.env.DEV) {
          console.error('Play error:', err);
        }
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    if (audioRef.current && duration) {
      audioRef.current.currentTime = percent * duration;
    }
  };

  const formatTime = (time) => {
    if (!time || isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const switchSong = (index) => {
    setCurrentSongIndex(index);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);  // ✅ FIX: Reset duration when switching songs
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  const handleDownload = async (song) => {
    // ✅ FIX: Support both camelCase and snake_case field names
    const audioUrl = getField(song, 'audioUrl', 'audio_url');
    
    if (!audioUrl) {
      alert('No hay audio disponible');
      return;
    }

    setDownloading(song.id);

    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      // ✅ FIX: Support both camelCase and snake_case for recipientName
      const recipientName = getField(song, 'recipientName', 'recipient_name', 'regalo');
      const versionLabel = songs.length > 1 ? `-v${song.version || 1}` : '';
      const a = document.createElement('a');
      a.href = url;
      a.download = `cancion-para-${recipientName}${versionLabel}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Download error:', err);
      }
      window.open(audioUrl, '_blank');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadAll = async () => {
    for (const song of songs) {
      await handleDownload(song);
      await new Promise(r => setTimeout(r, 500)); // Small delay between downloads
    }
  };

  const handleShare = async () => {
    // ✅ FIX: Support both camelCase and snake_case
    const recipientName = getField(currentSong, 'recipientName', 'recipient_name', 'alguien especial');
    const shareText = `¡Escucha la canción personalizada para ${recipientName}! 🎵`;
    const shareUrl = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'RegalosQueCantan', text: shareText, url: shareUrl });
      } catch (err) {}
    } else {
      navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      alert('¡Enlace copiado!');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-yellow-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-white">Cargando tu canción...</p>
        </div>
      </div>
    );
  }

  if (error && songs.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black flex items-center justify-center p-4">
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-6 max-w-md text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/" className="bg-yellow-500 text-black px-6 py-2 rounded-full font-semibold inline-block">
            Volver al Inicio
          </a>
        </div>
      </div>
    );
  }

  // ✅ FIX: Support both camelCase and snake_case throughout
  const audioUrl = getField(currentSong, 'audioUrl', 'audio_url');
  const imageUrl = getField(currentSong, 'imageUrl', 'image_url');
  const recipientName = getField(currentSong, 'recipientName', 'recipient_name', 'tu persona especial');
  const genre = getField(currentSong, 'genre', 'genre', 'Personalizado');
  const isMultipleSongs = songs.length > 1;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-black py-8 px-4">
      <div className="max-w-2xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-3xl font-bold text-white mb-2">¡Felicidades!</h1>
          <p className="text-gray-400">
            {isMultipleSongs ? (
              <>Tus <span className="text-yellow-500 font-semibold">{songs.length} canciones</span> para <span className="text-yellow-500 font-semibold">{recipientName}</span> están listas</>
            ) : (
              <>Tu canción para <span className="text-yellow-500 font-semibold">{recipientName}</span> está lista</>
            )}
          </p>
        </div>

        {/* Version Tabs (only if multiple songs) */}
        {isMultipleSongs && (
          <div className="flex justify-center gap-3 mb-6">
            {songs.map((song, index) => (
              <button
                key={song.id}
                onClick={() => switchSong(index)}
                className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${
                  currentSongIndex === index
                    ? 'bg-yellow-500 text-black'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Versión {song.version || index + 1}
              </button>
            ))}
          </div>
        )}

        {/* Main Card */}
        <div className="bg-gray-800/50 backdrop-blur rounded-2xl p-6 mb-6 border border-gray-700/50">
          
          {/* Album Art */}
          {imageUrl && (
            <img src={imageUrl} alt="Album Art" className="w-48 h-48 mx-auto rounded-xl shadow-lg mb-6 object-cover" />
          )}

          {/* Audio Player */}
          {audioUrl ? (
            <div className="mb-6">
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                preload="metadata"
              />
              
              <button
                onClick={togglePlay}
                className="w-20 h-20 mx-auto mb-4 bg-gradient-to-r from-yellow-500 to-yellow-600 rounded-full flex items-center justify-center hover:from-yellow-400 hover:to-yellow-500 transition-all shadow-lg"
              >
                {isPlaying ? (
                  <svg className="w-8 h-8 text-black" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg className="w-8 h-8 text-black ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
              </button>

              <div className="h-2 bg-gray-700 rounded-full cursor-pointer mb-2" onClick={handleSeek}>
                <div 
                  className="h-full bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-full"
                  style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>

              <div className="flex justify-between text-sm text-gray-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 mb-6">
              <p className="text-yellow-500">⚠️ Audio no disponible</p>
            </div>
          )}

          {/* Song Details */}
          <div className="border-t border-gray-700 pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Género</span>
              <span className="text-white">{genre}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Para</span>
              <span className="text-yellow-500 font-semibold">{recipientName}</span>
            </div>
            {isMultipleSongs && (
              <div className="flex justify-between">
                <span className="text-gray-500">Versión</span>
                <span className="text-white">{currentSong?.version || currentSongIndex + 1} de {songs.length}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Estado</span>
              <span className="text-green-400">✓ Pagado</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-4">
          
          {/* Download Current Song Button */}
          <button
            onClick={() => handleDownload(currentSong)}
            disabled={downloading === currentSong?.id || !audioUrl}
            className={`w-full py-4 rounded-full font-bold text-lg flex items-center justify-center gap-2 ${
              audioUrl ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black hover:from-yellow-400 hover:to-yellow-500' : 'bg-gray-700 text-gray-400'
            }`}
          >
            {downloading === currentSong?.id ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent"></div>
                Descargando...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {isMultipleSongs ? `Descargar Versión ${currentSong?.version || currentSongIndex + 1}` : 'Descargar Canción'}
              </>
            )}
          </button>

          {/* Download All Button (only if multiple songs) */}
          {isMultipleSongs && (
            <button
              onClick={handleDownloadAll}
              disabled={downloading !== null}
              className="w-full py-4 rounded-full font-bold text-lg border-2 border-green-500 text-green-500 hover:bg-green-500 hover:text-black transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Descargar Todas ({songs.length} canciones)
            </button>
          )}

          {/* Share Button */}
          <button
            onClick={handleShare}
            className="w-full py-4 rounded-full font-bold text-lg border-2 border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Compartir
          </button>

          {/* Direct Link */}
          {audioUrl && (
            <a href={audioUrl} target="_blank" rel="noopener noreferrer" className="block w-full py-3 text-center text-gray-400 hover:text-yellow-500 text-sm">
              Abrir audio en nueva pestaña →
            </a>
          )}

          {/* Create Another */}
          <a href="/" className="block w-full py-3 text-center text-gray-400 hover:text-white">
            Crear otra canción →
          </a>
        </div>
      </div>
    </div>
  );
}
