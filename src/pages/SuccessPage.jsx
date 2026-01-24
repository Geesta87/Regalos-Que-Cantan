import React, { useContext, useEffect, useState, useRef } from 'react';
import { AppContext } from '../App';
import genres from '../config/genres';

// Confetti component
const Confetti = () => {
  const colors = ['#D4AF37', '#E11D74', '#1A4338', '#FF6B6B', '#4ECDC4', '#FFE66D'];
  const confettiPieces = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 3,
    duration: 3 + Math.random() * 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: 8 + Math.random() * 8,
    rotation: Math.random() * 360
  }));

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      {confettiPieces.map((piece) => (
        <div
          key={piece.id}
          className="absolute animate-confetti"
          style={{
            left: `${piece.left}%`,
            top: '-20px',
            width: `${piece.size}px`,
            height: `${piece.size}px`,
            backgroundColor: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            transform: `rotate(${piece.rotation}deg)`,
            borderRadius: Math.random() > 0.5 ? '50%' : '0'
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti-fall linear forwards;
        }
      `}</style>
    </div>
  );
};

export default function SuccessPage() {
  const { formData, songData, clearSession, navigateTo } = useContext(AppContext);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showConfetti, setShowConfetti] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const audioRef = useRef(null);

  // =====================================================
  // FIX: Handle multiple song structures
  // =====================================================
  const getSongsArray = () => {
    // If we have a songs array (from ComparisonPage)
    if (songData?.songs && Array.isArray(songData.songs) && songData.songs.length > 0) {
      // Filter to only selected songs if selectedSongIds exists
      if (songData.selectedSongIds && songData.selectedSongIds.length > 0) {
        return songData.songs.filter(s => songData.selectedSongIds.includes(s.id));
      }
      return songData.songs;
    }
    
    // If we have song1/song2 format
    if (songData?.song1) {
      const songs = [songData.song1];
      if (songData.song2) songs.push(songData.song2);
      // Filter to selected if applicable
      if (songData.selectedSongIds && songData.selectedSongIds.length > 0) {
        return songs.filter(s => songData.selectedSongIds.includes(s.id));
      }
      return songs;
    }
    
    // Single song format (old format)
    if (songData?.id) {
      return [{
        id: songData.id,
        audioUrl: songData.audioUrl,
        previewUrl: songData.previewUrl,
        imageUrl: songData.imageUrl,
        lyrics: songData.lyrics
      }];
    }
    
    return [];
  };

  const songs = getSongsArray();
  const currentSong = songs[currentSongIndex] || {};
  const hasMultipleSongs = songs.length > 1;

  console.log('🎵 SuccessPage - songData:', songData);
  console.log('🎵 SuccessPage - songs array:', songs);
  console.log('🎵 SuccessPage - currentSong:', currentSong);

  // Get genre display name
  const genreConfig = genres?.[formData?.genre];
  const genreName = genreConfig?.name || formData?.genre || 'Género';
  const subGenreName = formData?.subGenre && genreConfig?.subGenres?.[formData.subGenre]?.name;

  // Hide confetti after animation
  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [currentSong?.audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * duration;
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Switch between songs (for multi-song purchases)
  const switchSong = (index) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setCurrentSongIndex(index);
  };

  // Force download via edge function
  const handleDownload = async (songIdToDownload = null) => {
    const downloadSongId = songIdToDownload || currentSong?.id;
    
    if (!downloadSongId) {
      console.error('No song ID available for download');
      setDownloadError('No se encontró la canción para descargar.');
      return;
    }

    setIsDownloading(true);
    setDownloadError('');

    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
      const downloadUrl = `${SUPABASE_URL}/functions/v1/download-song?songId=${downloadSongId}`;
      
      console.log('📥 Downloading from:', downloadUrl);
      
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Download response error:', errorText);
        throw new Error('Download failed');
      }

      // Get the blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      const cleanName = (formData?.recipientName || 'cancion')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const versionSuffix = hasMultipleSongs ? `-v${currentSongIndex + 1}` : '';

      const link = document.createElement('a');
      link.href = url;
      link.download = `cancion-para-${cleanName}${versionSuffix}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Download error:', error);
      setDownloadError('Error al descargar. Intenta de nuevo.');
      
      // Fallback: try direct download
      const audioUrl = currentSong?.audioUrl || currentSong?.previewUrl;
      if (audioUrl) {
        window.open(audioUrl, '_blank');
      }
    } finally {
      setIsDownloading(false);
    }
  };

  // Download all songs (for bundle purchases)
  const handleDownloadAll = async () => {
    for (let i = 0; i < songs.length; i++) {
      setCurrentSongIndex(i);
      await handleDownload(songs[i].id);
      // Small delay between downloads
      if (i < songs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  };

  const handleShareWhatsApp = () => {
    const shareUrl = `${window.location.origin}/preview?song_id=${currentSong?.id}`;
    const text = `🎵 ¡Escucha esta canción especial para ${formData?.recipientName}! ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleShareFacebook = () => {
    const shareUrl = `${window.location.origin}/preview?song_id=${currentSong?.id}`;
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
  };

  const handleCopyLink = async () => {
    const shareUrl = `${window.location.origin}/preview?song_id=${currentSong?.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert('¡Link copiado!');
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleCreateAnother = () => {
    if (clearSession) clearSession();
    navigateTo('landing');
  };

  // Get the audio URL for current song
  const audioUrl = currentSong?.audioUrl || currentSong?.previewUrl;
  const imageUrl = currentSong?.imageUrl;

  // Error state if no songs
  if (songs.length === 0) {
    return (
      <div className="min-h-screen bg-forest flex items-center justify-center">
        <div className="text-center text-white p-8">
          <span className="material-symbols-outlined text-6xl text-red-400 mb-4">error</span>
          <h2 className="text-2xl font-bold mb-4">No se encontró la canción</h2>
          <p className="text-white/60 mb-6">Hubo un problema al cargar tu canción.</p>
          <button
            onClick={() => navigateTo('landing')}
            className="px-8 py-4 bg-bougainvillea text-white rounded-full font-bold"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-forest text-white flex flex-col">
      {/* Confetti */}
      {showConfetti && <Confetti />}

      {/* Hidden Audio Element */}
      <audio 
        ref={audioRef} 
        src={audioUrl}
        preload="metadata"
      />

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center relative px-8 py-12">
        <div className="w-full max-w-lg">
          
          {/* Success Header */}
          <div className="text-center mb-10">
            <div className="text-6xl mb-4">🎉</div>
            <h1 className="text-4xl font-bold text-white mb-3">
              ¡Tu canción está lista!
            </h1>
            <p className="text-white/60">
              Ya la enviamos a <span className="text-gold">{formData?.email}</span>
            </p>
          </div>

          {/* Song Tabs (for multiple songs) */}
          {hasMultipleSongs && (
            <div className="flex justify-center gap-2 mb-6">
              {songs.map((song, index) => (
                <button
                  key={song.id}
                  onClick={() => switchSong(index)}
                  className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                    currentSongIndex === index
                      ? 'bg-gold text-forest'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  Versión {index + 1}
                </button>
              ))}
            </div>
          )}

          {/* Player Card */}
          <div className="bg-white/[0.03] backdrop-blur-sm rounded-2xl p-6 mb-8 border border-white/10">
            <div className="flex flex-col md:flex-row items-center gap-6">
              
              {/* Album Art */}
              <div className="relative w-40 h-40 rounded-xl overflow-hidden flex-shrink-0 group cursor-pointer" onClick={togglePlay}>
                {imageUrl ? (
                  <img src={imageUrl} alt="Album art" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-gold/20 to-bougainvillea/20 flex items-center justify-center">
                    <span className="text-6xl">🎵</span>
                  </div>
                )}
                <button 
                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-5xl text-white" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {isPlaying ? 'pause_circle' : 'play_circle'}
                  </span>
                </button>
              </div>

              {/* Player Info & Controls */}
              <div className="flex-1 w-full text-center md:text-left">
                <div className="mb-4">
                  <h3 className="text-2xl font-bold text-white mb-1">
                    Canción para {formData?.recipientName}
                  </h3>
                  <p className="text-gold uppercase tracking-[0.2em] text-xs font-bold">
                    {genreName}{subGenreName ? ` • ${subGenreName}` : ''} 
                  </p>
                  <p className="text-white/40 text-xs mt-1">
                    De: {formData?.senderName}
                  </p>
                </div>

                {/* Progress Bar */}
                <div 
                  className="flex items-center gap-3 h-12 mb-4 cursor-pointer group"
                  onClick={handleSeek}
                >
                  <span className="text-xs text-white/60 font-mono w-10">{formatTime(currentTime)}</span>
                  <div className="flex-1 h-2 bg-white/10 rounded-full relative overflow-hidden">
                    <div 
                      className="absolute left-0 top-0 h-full bg-gradient-to-r from-gold to-bougainvillea rounded-full transition-all"
                      style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                    ></div>
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ left: `calc(${duration ? (currentTime / duration) * 100 : 0}% - 8px)` }}
                    ></div>
                  </div>
                  <span className="text-xs text-white/60 font-mono w-10">{formatTime(duration)}</span>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-center md:justify-start gap-4">
                  <button 
                    onClick={() => { if (audioRef.current) audioRef.current.currentTime = 0; }}
                    className="material-symbols-outlined text-white/40 hover:text-white text-2xl transition-colors"
                  >
                    replay
                  </button>
                  <button 
                    onClick={togglePlay}
                    className="w-14 h-14 bg-white text-forest rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
                  >
                    <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {isPlaying ? 'pause' : 'play_arrow'}
                    </span>
                  </button>
                  <button className="material-symbols-outlined text-white/40 hover:text-white text-2xl transition-colors">
                    volume_up
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Download Button(s) */}
          <div className="text-center mb-8">
            <button
              onClick={() => handleDownload()}
              disabled={isDownloading}
              className="group relative inline-flex items-center justify-center overflow-hidden rounded-full h-20 px-16 bg-bougainvillea text-white text-xl font-bold transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_30px_rgba(225,29,116,0.5)] disabled:opacity-70"
            >
              <span className="relative z-10 flex items-center gap-3">
                {isDownloading ? (
                  <>
                    <span className="material-symbols-outlined animate-spin">progress_activity</span>
                    Descargando...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined">download</span>
                    Descargar MP3 {hasMultipleSongs ? `(V${currentSongIndex + 1})` : ''}
                  </>
                )}
              </span>
              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
            </button>

            {/* Download All Button (for bundle) */}
            {hasMultipleSongs && (
              <button
                onClick={handleDownloadAll}
                disabled={isDownloading}
                className="mt-4 text-gold hover:text-white transition-colors text-sm font-bold"
              >
                📥 Descargar todas las versiones
              </button>
            )}
            
            {downloadError && (
              <p className="text-red-400 text-sm mt-3">{downloadError}</p>
            )}
            
            <p className="text-white/40 text-xs mt-4 uppercase tracking-widest">
              También enviado a tu correo electrónico
            </p>
          </div>

          {/* Share Section */}
          <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-8 mb-10">
            <p className="text-white/60 text-sm uppercase tracking-[0.2em] font-bold mb-6 text-center">
              Comparte tu regalo musical
            </p>
            <div className="flex justify-center gap-4">
              <button 
                onClick={handleShareWhatsApp}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 hover:bg-white/5 hover:border-green-500/50 transition-all group"
              >
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center group-hover:bg-green-500/30 transition-colors">
                  <svg className="w-6 h-6 fill-green-400" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                </div>
                <span className="text-white/60 text-xs">WhatsApp</span>
              </button>

              <button 
                onClick={handleShareFacebook}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 hover:bg-white/5 hover:border-blue-500/50 transition-all group"
              >
                <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                  <svg className="w-6 h-6 fill-blue-400" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </div>
                <span className="text-white/60 text-xs">Facebook</span>
              </button>

              <button 
                onClick={handleCopyLink}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/10 hover:bg-white/5 hover:border-gold/50 transition-all group"
              >
                <div className="w-12 h-12 rounded-full bg-gold/20 flex items-center justify-center group-hover:bg-gold/30 transition-colors">
                  <span className="material-symbols-outlined text-gold">link</span>
                </div>
                <span className="text-white/60 text-xs">Copiar Link</span>
              </button>
            </div>
          </div>

          {/* Create Another */}
          <div className="text-center">
            <button
              onClick={handleCreateAnother}
              className="text-white/40 hover:text-white transition-colors text-sm uppercase tracking-widest flex items-center justify-center gap-2 group mx-auto"
            >
              Crear otra canción
              <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Decorative corners */}
        <div className="absolute top-40 left-10 w-24 h-24 border-l border-t border-gold/10 hidden lg:block"></div>
        <div className="absolute bottom-40 right-10 w-24 h-24 border-r border-b border-gold/10 hidden lg:block"></div>
      </main>

      {/* Footer */}
      <footer className="bg-background-dark py-10 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="font-display text-white/30 text-lg tracking-wider uppercase">RegalosQueCantan</div>
          <div className="flex gap-8">
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Ayuda</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-[10px] uppercase tracking-[0.2em]" href="#">Términos</a>
          </div>
          <p className="text-white/20 text-[10px] uppercase tracking-widest">© 2025 • Hecho con alma en México.</p>
        </div>
      </footer>
    </div>
  );
}
