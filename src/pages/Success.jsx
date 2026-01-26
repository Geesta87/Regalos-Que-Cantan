import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const Success = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const songId = searchParams.get('song_id');
  const sessionId = searchParams.get('session_id');

  // Load song on mount
  useEffect(() => {
    if (songId) {
      loadSong();
    } else {
      setError('No song ID provided');
      setLoading(false);
    }
  }, [songId]);

  const loadSong = async () => {
    try {
      setLoading(true);
      console.log('Loading song:', songId);
      
      // Fetch song directly from Supabase
      const { data, error: fetchError } = await supabase
        .from('songs')
        .select('*')
        .eq('id', songId)
        .single();

      console.log('Song data:', data);
      console.log('Fetch error:', fetchError);

      if (fetchError) {
        throw new Error('No se encontró la canción');
      }

      if (!data) {
        throw new Error('Canción no encontrada');
      }

      // If payment just completed, mark as paid
      if (sessionId && !data.paid) {
        console.log('Marking song as paid...');
        await supabase
          .from('songs')
          .update({ paid: true, paid_at: new Date().toISOString() })
          .eq('id', songId);
        data.paid = true;
      }

      setSong(data);
      console.log('Audio URL:', data.audio_url);

    } catch (err) {
      console.error('Load error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Audio controls
  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => {
        console.error('Play error:', err);
        setError('Error al reproducir audio');
      });
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
      console.log('Audio loaded, duration:', audioRef.current.duration);
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

  // Download handler
  const handleDownload = async () => {
    if (!song) return;
    
    if (!song.audio_url) {
      setError('No hay URL de audio disponible');
      return;
    }

    setDownloading(true);
    setError(null);

    try {
      console.log('Downloading from:', song.audio_url);
      
      const response = await fetch(song.audio_url);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `cancion-${song.recipient_name || 'regalo'}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error('Download error:', err);
      // Fallback: open in new tab
      window.open(song.audio_url, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  // Loading state
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

  // Error state (no song)
  if (error && !song) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black flex items-center justify-center p-4">
        <div className="bg-red-500/20 border border-red-500 rounded-lg p-6 max-w-md text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-yellow-500 text-black px-6 py-2 rounded-full font-semibold"
          >
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black py-8 px-4">
      <div className="max-w-2xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-3xl font-bold text-white mb-2">¡Felicidades!</h1>
          <p className="text-gray-400">
            Tu canción para <span className="text-yellow-500 font-semibold">{song?.recipient_name}</span> está lista
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-center">{error}</p>
          </div>
        )}

        {/* Main Card */}
        <div className="bg-gray-800/50 rounded-2xl p-6 mb-6">
          
          {/* Album Art */}
          {song?.image_url && (
            <img 
              src={song.image_url} 
              alt="Album Art"
              className="w-48 h-48 mx-auto rounded-xl shadow-lg mb-6 object-cover"
            />
          )}

          {/* Audio Player */}
          {song?.audio_url ? (
            <div className="mb-6">
              <audio
                ref={audioRef}
                src={song.audio_url}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={(e) => {
                  console.error('Audio error:', e);
                }}
                preload="metadata"
              />
              
              {/* Play Button */}
              <button
                onClick={togglePlay}
                className="w-20 h-20 mx-auto mb-4 bg-yellow-500 rounded-full flex items-center justify-center hover:bg-yellow-400 transition-colors shadow-lg"
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

              {/* Progress Bar */}
              <div 
                className="h-2 bg-gray-700 rounded-full cursor-pointer mb-2"
                onClick={handleSeek}
              >
                <div 
                  className="h-full bg-yellow-500 rounded-full transition-all"
                  style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>

              {/* Time */}
              <div className="flex justify-between text-sm text-gray-400">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 mb-6">
              <p className="text-yellow-500">⚠️ Audio no disponible</p>
              <p className="text-gray-400 text-sm mt-2">La canción aún se está procesando</p>
              <button 
                onClick={loadSong}
                className="mt-4 text-yellow-500 underline"
              >
                Recargar
              </button>
            </div>
          )}

          {/* Song Details */}
          <div className="border-t border-gray-700 pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Género</span>
              <span className="text-white">{song?.genre_name || song?.genre}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Ocasión</span>
              <span className="text-white">{song?.occasion_custom || song?.occasion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Estado</span>
              <span className={song?.paid ? 'text-green-400' : 'text-yellow-400'}>
                {song?.paid ? '✓ Pagado' : 'Pendiente'}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-4">
          
          {/* Download Button */}
          <button
            onClick={handleDownload}
            disabled={downloading || !song?.audio_url}
            className={`w-full py-4 rounded-full font-bold text-lg flex items-center justify-center gap-2 transition-all ${
              song?.audio_url
                ? 'bg-yellow-500 text-black hover:bg-yellow-400'
                : 'bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
          >
            {downloading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-black border-t-transparent"></div>
                Descargando...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Descargar Canción
              </>
            )}
          </button>

          {/* Direct Link (Fallback) */}
          {song?.audio_url && (
            <a
              href={song.audio_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 text-center text-yellow-500 hover:text-yellow-400 underline"
            >
              Abrir audio en nueva pestaña
            </a>
          )}

          {/* Create Another */}
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 text-gray-400 hover:text-white transition-colors"
          >
            Crear otra canción →
          </button>
        </div>

        {/* Debug Info */}
        <div className="mt-8 p-4 bg-gray-800/50 rounded-lg text-xs text-gray-500">
          <p>Song ID: {song?.id}</p>
          <p>Status: {song?.status}</p>
          <p>Paid: {song?.paid ? 'Yes' : 'No'}</p>
          <p>Audio: {song?.audio_url ? 'Yes ✓' : 'No ✗'}</p>
        </div>
      </div>
    </div>
  );
};

export default Success;
