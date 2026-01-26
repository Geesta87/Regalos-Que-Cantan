import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import genres from '../config/genres';

export default function SuccessPage() {
  const { formData, songData, setSongData, navigateTo } = useContext(AppContext);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  
  const audioRef = useRef(null);

  // Get genre display name
  const genreConfig = genres[formData?.genre];
  const genreName = genreConfig?.name || formData?.genre || 'Latino';

  // Get song info
  const recipientName = songData?.recipientName || formData?.recipientName || 'tu ser querido';
  const audioUrl = songData?.audioUrl || songData?.audio_url;
  const imageUrl = songData?.imageUrl || songData?.image_url;
  const occasion = formData?.occasionCustom || formData?.occasion || '';

  // Audio controls
  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => {
        console.error('Play error:', err);
        setError('Error al reproducir. Intenta descargar el archivo.');
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

  // Download handler
  const handleDownload = async () => {
    if (!audioUrl) {
      setError('No hay audio disponible para descargar');
      return;
    }

    setDownloading(true);
    setError(null);

    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `cancion-para-${recipientName.replace(/\s+/g, '-')}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
    } catch (err) {
      console.error('Download error:', err);
      // Fallback: open in new tab
      window.open(audioUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  // Share handler
  const handleShare = async () => {
    const shareText = `¡Escucha la canción personalizada que creé para ${recipientName}! 🎵`;
    const shareUrl = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'RegalosQueCantan',
          text: shareText,
          url: shareUrl
        });
      } catch (err) {
        console.log('Share cancelled');
      }
    } else {
      navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      alert('¡Enlace copiado al portapapeles!');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-900 to-black py-8 px-4">
      <div className="max-w-2xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-3xl font-bold text-white mb-2">¡Felicidades!</h1>
          <p className="text-gray-400">
            Tu canción para <span className="text-yellow-500 font-semibold">{recipientName}</span> está lista
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-center">{error}</p>
          </div>
        )}

        {/* Main Card */}
        <div className="bg-gray-800/50 backdrop-blur rounded-2xl p-6 mb-6 border border-gray-700/50">
          
          {/* Album Art */}
          {imageUrl && (
            <img 
              src={imageUrl} 
              alt="Album Art"
              className="w-48 h-48 mx-auto rounded-xl shadow-lg mb-6 object-cover"
            />
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
                onError={(e) => console.error('Audio error:', e)}
                preload="metadata"
              />
              
              {/* Play Button */}
              <button
                onClick={togglePlay}
                className="w-20 h-20 mx-auto mb-4 bg-gradient-to-r from-yellow-500 to-yellow-600 rounded-full flex items-center justify-center hover:from-yellow-400 hover:to-yellow-500 transition-all shadow-lg shadow-yellow-500/25"
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
                className="h-2 bg-gray-700 rounded-full cursor-pointer mb-2 overflow-hidden"
                onClick={handleSeek}
              >
                <div 
                  className="h-full bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-full transition-all"
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
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-yellow-500 border-t-transparent mx-auto mb-4"></div>
              <p className="text-yellow-500">Preparando audio...</p>
            </div>
          )}

          {/* Song Details */}
          <div className="border-t border-gray-700 pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Género</span>
              <span className="text-white">{genreName}</span>
            </div>
            {occasion && (
              <div className="flex justify-between">
                <span className="text-gray-500">Ocasión</span>
                <span className="text-white">{occasion}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Para</span>
              <span className="text-yellow-500 font-semibold">{recipientName}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-4">
          
          {/* Download Button */}
          <button
            onClick={handleDownload}
            disabled={downloading || !audioUrl}
            className={`w-full py-4 rounded-full font-bold text-lg flex items-center justify-center gap-2 transition-all ${
              audioUrl
                ? 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-black hover:from-yellow-400 hover:to-yellow-500 shadow-lg shadow-yellow-500/25'
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

          {/* Direct Link Fallback */}
          {audioUrl && (
            <a
              href={audioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 text-center text-gray-400 hover:text-yellow-500 transition-colors text-sm"
            >
              Abrir audio en nueva pestaña →
            </a>
          )}

          {/* Create Another */}
          <button
            onClick={() => navigateTo('landing')}
            className="w-full py-3 text-gray-400 hover:text-white transition-colors"
          >
            Crear otra canción →
          </button>
        </div>

      </div>
    </div>
  );
}
