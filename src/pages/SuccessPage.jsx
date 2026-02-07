import React, { useEffect, useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function SuccessPage() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(false);
  
  const audioRef = useRef(null);

  // Get song IDs from URL - supports both song_id and song_ids
  const urlParams = new URLSearchParams(window.location.search);
  const songIdsParam = urlParams.get('song_ids') || urlParams.get('song_id');

  useEffect(() => {
    if (songIdsParam) {
      loadSongs();
    } else {
      setError('No se encontró el ID de la canción');
      setLoading(false);
    }
  }, [songIdsParam]);

  const loadSongs = async () => {
    try {
      setLoading(true);
      const songIds = songIdsParam.split(',').filter(id => id.trim());
      
      console.log('Loading songs:', songIds);

      const { data, error: fetchError } = await supabase
        .from('songs')
        .select('*')
        .in('id', songIds);

      if (fetchError) {
        console.error('Fetch error:', fetchError);
        throw new Error('Error al cargar la canción');
      }

      if (!data || data.length === 0) {
        throw new Error('No se encontró la canción');
      }

      console.log('Songs loaded:', data);
      setSongs(data);
      setCurrentSong(data[0]);
    } catch (err) {
      console.error('Load error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Audio player handlers
  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
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
    if (audioRef.current) {
      audioRef.current.currentTime = percent * duration;
    }
  };

  const formatTime = (time) => {
    if (!time || isNaN(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleDownload = async () => {
    if (!currentSong?.audio_url) return;
    
    setDownloading(true);
    try {
      const response = await fetch(currentSong.audio_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cancion-para-${currentSong.recipient_name || 'ti'}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // Fallback: open in new tab
      window.open(currentSong.audio_url, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-white">Cargando tu canción...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/" className="text-emerald-400 hover:underline">Volver al inicio</a>
        </div>
      </div>
    );
  }

  // Song not ready yet (no audio_url)
  if (!currentSong?.audio_url) {
    return (
      <div className="min-h-screen bg-[#0a1628] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#1a2f4a] rounded-3xl p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <span className="text-4xl">🎵</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-4">¡Pago Exitoso!</h1>
          <p className="text-gray-300 mb-6">
            Tu canción para <span className="text-emerald-400 font-semibold">{currentSong?.recipient_name}</span> está siendo creada.
          </p>
          <div className="bg-white/5 rounded-xl p-4 mb-6">
            <p className="text-sm text-gray-400">Recibirás un email cuando esté lista.</p>
            <p className="text-xs text-gray-500 mt-2">Tiempo estimado: 2-5 minutos</p>
          </div>
          <button
            onClick={loadSongs}
            className="px-6 py-3 bg-emerald-500 text-white rounded-full font-semibold hover:bg-emerald-400 transition"
          >
            🔄 Verificar Estado
          </button>
        </div>
      </div>
    );
  }

  // Song is ready - show player!
  return (
    <div className="min-h-screen bg-[#0a1628] py-8 px-4">
      <div className="max-w-md mx-auto">
        
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-500 flex items-center justify-center">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">🎉 ¡Tu Canción Está Lista!</h1>
          <p className="text-gray-400">
            Canción para <span className="text-emerald-400 font-semibold">{currentSong.recipient_name}</span>
          </p>
        </div>

        {/* Audio Player Card */}
        <div className="bg-gradient-to-br from-[#1a3a2f] to-[#0d2620] rounded-3xl p-6 mb-6 border border-emerald-500/20">
          
          {/* Song Info */}
          <div className="text-center mb-6">
            <div className="w-24 h-24 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 flex items-center justify-center shadow-lg">
              <span className="text-5xl">🎵</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-1">
              Para: {currentSong.recipient_name}
            </h2>
            <p className="text-gray-400 text-sm">
              De: {currentSong.sender_name}
            </p>
            <p className="text-emerald-400 text-sm mt-1 capitalize">
              {currentSong.genre} • {currentSong.occasion?.replace(/_/g, ' ')}
            </p>
          </div>

          {/* Hidden Audio Element */}
          <audio
            ref={audioRef}
            src={currentSong.audio_url}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
          />

          {/* Play Button */}
          <button
            onClick={togglePlay}
            className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg hover:bg-emerald-400 transition-all hover:scale-105"
          >
            {isPlaying ? (
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Progress Bar */}
          <div 
            className="h-2 bg-white/10 rounded-full cursor-pointer mb-2 overflow-hidden"
            onClick={handleSeek}
          >
            <div 
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${(currentTime / duration) * 100 || 0}%` }}
            />
          </div>

          {/* Time Display */}
          <div className="flex justify-between text-xs text-gray-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Download Button */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 text-black font-bold text-lg rounded-full flex items-center justify-center gap-2 hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50 mb-4"
        >
          {downloading ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent"></div>
              Descargando...
            </>
          ) : (
            <>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Descargar MP3
            </>
          )}
        </button>

        {/* Share Section */}
        <div className="bg-[#1a2f4a] rounded-2xl p-5 mb-6">
          <h3 className="text-white font-semibold mb-3 text-center">💝 Compartir</h3>
          <div className="flex justify-center gap-3">
            <a
              href={`https://wa.me/?text=¡Escucha%20esta%20canción%20personalizada!%20${encodeURIComponent(window.location.href)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-400 transition"
            >
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                alert('¡Enlace copiado!');
              }}
              className="w-12 h-12 rounded-full bg-gray-600 flex items-center justify-center hover:bg-gray-500 transition"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Multiple Songs Selector */}
        {songs.length > 1 && (
          <div className="bg-[#1a2f4a] rounded-2xl p-4 mb-6">
            <h3 className="text-white font-semibold mb-3">🎵 Tus Canciones ({songs.length})</h3>
            <div className="space-y-2">
              {songs.map((song, index) => (
                <button
                  key={song.id}
                  onClick={() => {
                    setCurrentSong(song);
                    setIsPlaying(false);
                    setCurrentTime(0);
                  }}
                  className={`w-full p-3 rounded-xl text-left transition ${
                    currentSong.id === song.id 
                      ? 'bg-emerald-500/20 border border-emerald-500/50' 
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <span className="text-white">Versión {index + 1}</span>
                  {currentSong.id === song.id && (
                    <span className="ml-2 text-emerald-400">▶ Reproduciendo</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Back to Home */}
        <div className="text-center">
          <a 
            href="/"
            className="text-gray-400 hover:text-white transition"
          >
            ← Crear otra canción
          </a>
        </div>
      </div>
    </div>
  );
}
