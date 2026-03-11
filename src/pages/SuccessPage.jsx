import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { createVideoCheckout, checkVideoStatus, generateVideo } from '../services/api';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// CONFETTI — Canvas-based particle system
// ============================================================
function Confetti({ intensity = 200 }) {
  const canvasRef = useRef(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const colors = ['#f74da6', '#e11d74', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899', '#fbbf24', '#06b6d4'];
    const particles = [];
    
    for (let i = 0; i < intensity; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 12 + 4,
        h: Math.random() * 8 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: Math.random() * 4 + 2,
        wobble: Math.random() * 10,
        wobbleSpeed: Math.random() * 0.05 + 0.02,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 8,
        opacity: 1,
        shape: Math.random() > 0.5 ? 'rect' : 'circle'
      });
    }
    
    let frame = 0;
    let animId;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;
      
      let alive = false;
      particles.forEach(p => {
        p.y += p.speed;
        p.x += Math.sin(frame * p.wobbleSpeed + p.wobble) * 2;
        p.rotation += p.rotSpeed;
        
        if (frame > 200) p.opacity = Math.max(0, p.opacity - 0.006);
        
        if (p.opacity > 0 && p.y < canvas.height + 20) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          if (p.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          }
          ctx.restore();
        }
      });
      
      if (alive) animId = requestAnimationFrame(animate);
    };
    
    animate();
    return () => cancelAnimationFrame(animId);
  }, [intensity]);
  
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 100
      }}
    />
  );
}

// ============================================================
// COUNTDOWN OVERLAY — Full-screen 3...2...1 with dramatic reveal
// ============================================================
function CountdownOverlay({ onComplete, recipientName }) {
  const [count, setCount] = useState(3);
  const [phase, setPhase] = useState('counting'); // counting | flash | done

  useEffect(() => {
    const timers = [
      setTimeout(() => setCount(2), 1000),
      setTimeout(() => setCount(1), 2000),
      setTimeout(() => setPhase('flash'), 2800),
      setTimeout(() => {
        setPhase('done');
        onComplete();
      }, 3200),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  if (phase === 'done') return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: phase === 'flash'
        ? 'radial-gradient(circle, rgba(242,13,128,0.4), rgba(24,17,20,0.98))'
        : 'linear-gradient(160deg, #110d0f 0%, #181114 40%, #1e1519 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.4s ease',
      overflow: 'hidden'
    }}>
      {/* Ambient glow rings */}
      <div style={{
        position: 'absolute',
        width: '400px', height: '400px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(242,13,128,0.08), transparent 70%)',
        animation: 'pulseRing 2s ease-in-out infinite'
      }} />
      <div style={{
        position: 'absolute',
        width: '600px', height: '600px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(225,29,116,0.05), transparent 70%)',
        animation: 'pulseRing 2.5s ease-in-out infinite 0.5s'
      }} />

      <style>{`
        @keyframes pulseRing {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes countPop {
          0% { transform: scale(0.3); opacity: 0; filter: blur(10px); }
          40% { transform: scale(1.15); opacity: 1; filter: blur(0); }
          60% { transform: scale(0.95); }
          80% { transform: scale(1.02); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes flashBurst {
          0% { transform: scale(0); opacity: 1; }
          100% { transform: scale(6); opacity: 0; }
        }
        @keyframes subtitleSlide {
          0% { transform: translateY(15px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {phase === 'counting' && (
        <>
          {/* Small context line */}
          <p style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: '14px',
            letterSpacing: '4px',
            textTransform: 'uppercase',
            marginBottom: '24px',
            fontFamily: "'Montserrat', sans-serif",
            animation: 'subtitleSlide 0.6s ease-out'
          }}>
            La canción para {recipientName}
          </p>

          {/* The big number */}
          <div
            key={count}
            style={{
              fontSize: 'clamp(120px, 35vw, 220px)',
              fontWeight: '900',
              lineHeight: 1,
              fontFamily: "'Montserrat', sans-serif",
              background: 'linear-gradient(180deg, #f74da6 0%, #f20d80 50%, #c0095e 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              textShadow: 'none',
              filter: 'drop-shadow(0 0 40px rgba(242,13,128,0.4))',
              animation: 'countPop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
              position: 'relative'
            }}
          >
            {count}
          </div>

          {/* Subtitle that changes */}
          <p
            key={`sub-${count}`}
            style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: '18px',
              marginTop: '20px',
              fontFamily: "'Montserrat', sans-serif",
              fontStyle: 'italic',
              animation: 'subtitleSlide 0.5s ease-out 0.2s both'
            }}
          >
            {count === 3 && '🎸 Preparando los instrumentos...'}
            {count === 2 && '🎤 Afinando la voz...'}
            {count === 1 && '🎵 ¡Aquí viene!'}
          </p>
        </>
      )}

      {phase === 'flash' && (
        <div style={{
          width: '80px', height: '80px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, #f74da6, #f20d80)',
          animation: 'flashBurst 0.5s ease-out forwards'
        }} />
      )}
    </div>
  );
}

// ============================================================
// MAIN SUCCESS PAGE
// ============================================================
export default function SuccessPage() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Template picker + photo upload states
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  // Video upsell states
  const [videoOrder, setVideoOrder] = useState(null); // null | { id, status, video_url, ... }
  const [videoPhotos, setVideoPhotos] = useState([]); // array of { file, preview }
  const [uploadingVideoPics, setUploadingVideoPics] = useState(false);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [videoPurchasing, setVideoPurchasing] = useState(false);
  const videoPhotoInputRef = useRef(null);
  const videoPollingRef = useRef(null);

  // Countdown + reveal states
  const [showCountdown, setShowCountdown] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);

  const audioRef = useRef(null);
  const hasTriggeredCountdown = useRef(false);

  const urlParams = new URLSearchParams(window.location.search);
  const songIdsParam = urlParams.get('song_ids') || urlParams.get('song_id');

  // ------ Load songs from DB ------
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

      const { data, error: fetchError } = await supabase
        .from('songs')
        .select('*')
        .in('id', songIds);

      if (fetchError) throw new Error('Error al cargar la canción');
      if (!data || data.length === 0) throw new Error('No se encontró la canción');

      setSongs(data);
      setCurrentSong(data[0]);
      setSelectedTemplate(data[0]?.template || 'golden_hour');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ------ 🔥 META PIXEL: Track Purchase after Stripe payment ------
  const hasFiredPurchase = useRef(false);
  useEffect(() => {
    if (hasFiredPurchase.current) return;
    if (!songs.length) return;

    // Only fire if coming from Stripe (session_id present)
    const sessionId = urlParams.get('session_id');
    if (!sessionId) return;

    hasFiredPurchase.current = true;

    // Determine purchase value based on number of songs
    const purchaseValue = songs.length > 1 ? 34.99 : 24.99;

    // Fire Meta Pixel Purchase event
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'Purchase', {
        value: purchaseValue,
        currency: 'USD',
        content_type: 'product',
        content_name: `Canción para ${songs[0]?.recipient_name || 'regalo'}`,
        content_ids: songs.map(s => s.id),
        num_items: songs.length
      });
      console.log('[Meta Pixel] Purchase event fired:', purchaseValue, 'USD');
    }
  }, [songs]);

  // ------ Start countdown once song + audio are ready ------
  useEffect(() => {
    if (!currentSong?.audio_url || hasTriggeredCountdown.current) return;
    hasTriggeredCountdown.current = true;

    // Small delay so audio element mounts and starts preloading
    setTimeout(() => setShowCountdown(true), 400);
  }, [currentSong]);

  // ------ Countdown complete → reveal ------
  const handleCountdownComplete = useCallback(() => {
    setShowCountdown(false);
    setShowConfetti(true);
    setRevealed(true);

    // Try auto-play
    if (audioRef.current) {
      audioRef.current.volume = 0.8;
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.then(() => setIsPlaying(true)).catch(() => {});
      }
    }

    // Stagger content appearance
    setTimeout(() => setContentVisible(true), 200);

    // Confetti fades after 6s
    setTimeout(() => setShowConfetti(false), 6000);
  }, []);

  // ------ Audio controls ------
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.volume = 1.0;
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    if (audioRef.current) audioRef.current.currentTime = percent * duration;
  };

  const formatTime = (time) => {
    if (!time || isNaN(time)) return '0:00';
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ------ Download ------
  const handleDownload = async (song) => {
    const target = song || currentSong;
    if (!target?.audio_url) return;
    setDownloading(true);
    try {
      const response = await fetch(target.audio_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cancion-para-${target.recipient_name || 'ti'}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      window.open(target.audio_url, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    for (const song of songs) {
      await handleDownload(song);
    }
  };

  // ------ Share ------
  // ------ TEMPLATE & PHOTO HANDLERS ------
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('La foto debe ser menor a 5MB'); return; }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSaveTemplate = async () => {
    if (!songs.length || !selectedTemplate) return;
    setSavingTemplate(true);
    try {
      let photoUrl = currentSong?.photo_url || null;

      // Upload photo if selected
      if (photoFile) {
        setUploadingPhoto(true);
        const ext = photoFile.name.split('.').pop();
        const filePath = `${songs[0].id}.${ext}`;
        
        const { error: uploadErr } = await supabase.storage
          .from('song-photos')
          .upload(filePath, photoFile, { cacheControl: '31536000', upsert: true });
        
        if (uploadErr) throw uploadErr;
        
        const { data: urlData } = supabase.storage.from('song-photos').getPublicUrl(filePath);
        photoUrl = urlData.publicUrl;
        setUploadingPhoto(false);
      }

      // Update ALL songs with same template + photo
      const songIds = songs.map(s => s.id);
      const { error: updateErr } = await supabase
        .from('songs')
        .update({ 
          template: selectedTemplate,
          ...(photoUrl ? { photo_url: photoUrl } : {})
        })
        .in('id', songIds);

      if (updateErr) throw updateErr;

      // Update local state for all songs
      setSongs(prev => prev.map(s => ({ ...s, template: selectedTemplate, ...(photoUrl ? { photo_url: photoUrl } : {}) })));
      setCurrentSong(prev => prev ? { ...prev, template: selectedTemplate, ...(photoUrl ? { photo_url: photoUrl } : {}) } : prev);
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 3000);
    } catch (err) {
      console.error('Error saving template:', err);
      alert('Error al guardar. Intenta de nuevo.');
    } finally {
      setSavingTemplate(false);
      setUploadingPhoto(false);
    }
  };

  // ------ VIDEO UPSELL: Detect video_paid URL param & check status on load ------
  const hasFiredVideoCheck = useRef(false);
  useEffect(() => {
    if (hasFiredVideoCheck.current) return;
    if (!songs.length) return;
    const songId = songs[0]?.id;
    if (!songId) return;
    hasFiredVideoCheck.current = true;

    // Check if there's an existing video order for this song
    checkVideoStatus(songId)
      .then(res => {
        if (res?.videoOrder) {
          setVideoOrder(res.videoOrder);
          // If processing, start polling
          if (res.videoOrder.status === 'processing') {
            startVideoPolling(songId);
          }
        }
      })
      .catch(() => {}); // No video order yet, that's fine
  }, [songs]);

  // ------ VIDEO UPSELL: Polling for video render completion ------
  const startVideoPolling = useCallback((songId) => {
    if (videoPollingRef.current) clearInterval(videoPollingRef.current);
    setVideoGenerating(true);
    videoPollingRef.current = setInterval(async () => {
      try {
        const res = await checkVideoStatus(songId);
        if (res?.videoOrder) {
          setVideoOrder(res.videoOrder);
          if (res.videoOrder.status === 'completed' || res.videoOrder.status === 'failed') {
            clearInterval(videoPollingRef.current);
            videoPollingRef.current = null;
            setVideoGenerating(false);
            if (res.videoOrder.status === 'failed') {
              setVideoError(res.videoOrder.error_message || 'Error al generar el video');
            }
          }
        }
      } catch (err) {
        console.error('Video poll error:', err);
      }
    }, 5000);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (videoPollingRef.current) clearInterval(videoPollingRef.current);
    };
  }, []);

  // ------ VIDEO UPSELL: Purchase handler ------
  const handleVideoPurchase = async () => {
    if (!songs.length) return;
    setVideoPurchasing(true);
    setVideoError(null);
    try {
      const res = await createVideoCheckout(songs[0].id, songs[0].email || '');
      if (res?.url) {
        window.location.href = res.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      setVideoError('Error al iniciar la compra. Intenta de nuevo.');
      setVideoPurchasing(false);
    }
  };

  // ------ VIDEO UPSELL: Photo upload handler ------
  const handleVideoPhotoSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Limit to 15 photos total
    const totalPhotos = videoPhotos.length + files.length;
    if (totalPhotos > 15) {
      setVideoError(`Máximo 15 fotos. Ya tienes ${videoPhotos.length}, seleccionaste ${files.length}.`);
      return;
    }

    // Validate each file (max 5MB, images only)
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        setVideoError(`"${file.name}" es mayor a 5MB.`);
        return;
      }
      if (!file.type.startsWith('image/')) {
        setVideoError(`"${file.name}" no es una imagen válida.`);
        return;
      }
    }

    setVideoError(null);

    // Create previews
    const newPhotos = files.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    }));

    setVideoPhotos(prev => [...prev, ...newPhotos]);
  };

  const removeVideoPhoto = (index) => {
    setVideoPhotos(prev => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  // ------ VIDEO UPSELL: Upload photos to Supabase & trigger generation ------
  const handleVideoGenerate = async () => {
    if (videoPhotos.length < 3) {
      setVideoError('Necesitas al menos 3 fotos para generar el video.');
      return;
    }
    if (!videoOrder?.id) {
      setVideoError('No se encontró la orden de video.');
      return;
    }

    setUploadingVideoPics(true);
    setVideoError(null);

    try {
      const photoUrls = [];

      // Upload each photo to Supabase Storage
      for (let i = 0; i < videoPhotos.length; i++) {
        const photo = videoPhotos[i];
        const ext = photo.file.name.split('.').pop();
        const filePath = `${videoOrder.id}/${i}_${Date.now()}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from('video-photos')
          .upload(filePath, photo.file, { cacheControl: '31536000', upsert: true });

        if (uploadErr) throw new Error(`Error subiendo foto ${i + 1}: ${uploadErr.message}`);

        const { data: urlData } = supabase.storage.from('video-photos').getPublicUrl(filePath);
        photoUrls.push(urlData.publicUrl);
      }

      // Update video_orders with photo URLs and status
      const { error: updateErr } = await supabase
        .from('video_orders')
        .update({ photo_urls: photoUrls, status: 'photos_uploaded', photo_count: photoUrls.length })
        .eq('id', videoOrder.id);

      if (updateErr) throw new Error('Error guardando fotos en la orden');

      setUploadingVideoPics(false);

      // Trigger video generation
      setVideoGenerating(true);
      const genRes = await generateVideo(videoOrder.id);

      // Update local state
      setVideoOrder(prev => ({ ...prev, status: 'processing' }));

      // Start polling
      startVideoPolling(songs[0].id);

    } catch (err) {
      console.error('Video generation error:', err);
      setVideoError(err.message || 'Error al generar el video. Intenta de nuevo.');
      setUploadingVideoPics(false);
      setVideoGenerating(false);
    }
  };

  // ------ VIDEO UPSELL: Download handler ------
  const handleVideoDownload = async () => {
    if (!videoOrder?.video_url) return;
    try {
      const response = await fetch(videoOrder.video_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `video-para-${recipientName || 'ti'}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(videoOrder.video_url, '_blank');
    }
  };

  // Build share URL — includes ALL song IDs for combos
  const allSongIds = songs.map(s => s.id).filter(Boolean).join(',');
  const songUrl = allSongIds ? `${window.location.origin}/song/${allSongIds}` : '';
  const isCombo = songs.length > 1;

  const handleShareWhatsApp = () => {
    const name = currentSong?.recipient_name || '';
    const url = songUrl || window.location.href;
    const text = isCombo
      ? `🎵 ¡Escucha estas 2 canciones que hice especialmente para ${name}! 🎁\n\n${url}`
      : `🎵 ¡Escucha esta canción que hice especialmente para ${name}! 🎁\n\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleCopyLink = () => {
    const url = songUrl || window.location.href;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // ------ Derived data ------
  const recipientName = currentSong?.recipient_name || 'ti';
  const senderName = currentSong?.sender_name || '';
  const genre = currentSong?.genre || '';
  const occasion = currentSong?.occasion?.replace(/_/g, ' ') || '';

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div style={S.fullScreenCenter}>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '56px', height: '56px', margin: '0 auto 20px',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#f74da6',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
          }} />
          <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.6)', fontFamily: "'Montserrat', sans-serif" }}>
            Preparando tu canción...
          </p>
        </div>
      </div>
    );
  }

  // ==================== ERROR ====================
  if (error) {
    return (
      <div style={S.fullScreenCenter}>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>😔</div>
          <p style={{ color: '#f87171', marginBottom: '16px', fontSize: '18px', fontFamily: "'Montserrat', sans-serif" }}>{error}</p>
          <a href="/" style={{ color: '#f74da6', textDecoration: 'none', fontWeight: '600', fontFamily: "'Montserrat', sans-serif" }}>← Volver al inicio</a>
        </div>
      </div>
    );
  }

  // ==================== SONG NOT READY ====================
  if (!currentSong?.audio_url) {
    return (
      <div style={S.fullScreenCenter}>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet" />
        <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }`}</style>
        <div style={{
          maxWidth: '420px', width: '100%',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: '28px', padding: '44px 32px',
          textAlign: 'center',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)'
        }}>
          <div style={{
            width: '80px', height: '80px', margin: '0 auto 24px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.05))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'pulse 2s ease-in-out infinite'
          }}>
            <span style={{ fontSize: '36px' }}>🎵</span>
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '12px', fontFamily: "'Montserrat', sans-serif" }}>¡Pago Exitoso!</h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '28px', fontSize: '15px', fontFamily: "'Montserrat', sans-serif", lineHeight: '1.6' }}>
            Tu canción para <span style={{ color: '#f74da6', fontWeight: '700' }}>{currentSong?.recipient_name}</span> está siendo creada.
          </p>
          <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)', marginBottom: '24px', fontFamily: "'Montserrat', sans-serif" }}>
            Recibirás un email cuando esté lista • ~2-5 min
          </p>
          <button
            onClick={loadSongs}
            style={{
              padding: '14px 32px',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: 'white', border: 'none', borderRadius: '50px',
              fontWeight: '700', fontSize: '15px', cursor: 'pointer',
              fontFamily: "'Montserrat', sans-serif",
              boxShadow: '0 6px 25px rgba(34,197,94,0.35)'
            }}
          >
            🔄 Verificar Estado
          </button>
        </div>
      </div>
    );
  }


  // ==================== TEMPLATE THEME ====================
  const themes = {
    golden_hour: {
      bg: 'linear-gradient(160deg, #1a1408 0%, #2a1f10 25%, #1e1508 50%, #0f0c04 100%)',
      accent: '#f4c025', accentRgb: '244,192,37',
      accentGrad: 'linear-gradient(135deg, #f4c025, #fde68a)',
      textPrimary: 'white', textSecondary: 'rgba(255,255,255,0.5)',
      cardBg: 'rgba(255,255,255,0.08)', cardBorder: 'rgba(255,255,255,0.12)',
      cardBlur: 'blur(20px)',
      font: "'Plus Jakarta Sans', sans-serif",
      fontImport: 'Plus+Jakarta+Sans:wght@300;400;500;600;700;800',
      glowColor: 'rgba(244,192,37,0.06)', glowColor2: 'rgba(200,150,50,0.04)',
      btnText: '#1a1408',
    },
    lavender_dream: {
      bg: 'radial-gradient(circle at top right, #fdfbf7 0%, #f0e9f7 50%, #e8dff5 100%)',
      accent: '#9947eb', accentRgb: '153,71,235',
      accentGrad: 'linear-gradient(135deg, #9947eb, #c084fc)',
      textPrimary: '#0f172a', textSecondary: '#64748b',
      cardBg: 'linear-gradient(135deg, #fff, #f7f2fb)', cardBorder: 'rgba(153,71,235,0.12)',
      cardBlur: 'none',
      font: "'Newsreader', serif",
      fontImport: 'Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800',
      glowColor: 'rgba(153,71,235,0.05)', glowColor2: 'rgba(153,71,235,0.08)',
      btnText: 'white',
    },
    electric_magenta: {
      bg: 'linear-gradient(160deg, #0a0507 0%, #150a10 50%, #0a0507 100%)',
      accent: '#f20d59', accentRgb: '242,13,89',
      accentGrad: 'linear-gradient(135deg, #f20d59, #ff5c93)',
      textPrimary: 'white', textSecondary: 'rgba(255,255,255,0.45)',
      cardBg: 'rgba(255,255,255,0.04)', cardBorder: 'rgba(242,13,89,0.15)',
      cardBlur: 'blur(12px)',
      font: "'Space Grotesk', sans-serif",
      fontImport: 'Space+Grotesk:wght@300;400;500;600;700',
      glowColor: 'rgba(242,13,89,0.06)', glowColor2: 'rgba(242,13,89,0.04)',
      btnText: 'white',
    },
  };
  const ts = themes[selectedTemplate] || themes.golden_hour;
  const isLight = selectedTemplate === 'lavender_dream';

  // ==================== MAIN SUCCESS PAGE ====================
  return (
    <div style={{
      background: ts.bg,
      color: ts.textPrimary, minHeight: '100vh',
      padding: '0 16px 40px',
      overflow: 'hidden',
      fontFamily: ts.font,
      position: 'relative',
    }}>
      <link href={`https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=${ts.fontImport}&display=swap`} rel="stylesheet" />

      {/* --- COUNTDOWN OVERLAY --- */}
      {showCountdown && (
        <CountdownOverlay
          onComplete={handleCountdownComplete}
          recipientName={recipientName}
        />
      )}

      {/* --- CONFETTI --- */}
      {showConfetti && <Confetti intensity={250} />}

      {/* --- HIDDEN AUDIO --- */}
      <audio
        ref={audioRef}
        src={currentSong.audio_url}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />

      {/* --- CSS --- */}
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmerAccent { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(${ts.accentRgb},0.2), 0 0 60px rgba(${ts.accentRgb},0.08); }
          50% { box-shadow: 0 0 35px rgba(${ts.accentRgb},0.4), 0 0 80px rgba(${ts.accentRgb},0.15); }
        }
        @keyframes eq1 { 0%, 100% { height: 8px; } 50% { height: 28px; } }
        @keyframes eq2 { 0%, 100% { height: 18px; } 50% { height: 8px; } }
        @keyframes eq3 { 0%, 100% { height: 12px; } 50% { height: 32px; } }
        @keyframes eq4 { 0%, 100% { height: 6px; } 50% { height: 22px; } }
        @keyframes floatUp { 0% { opacity:0; transform:translateY(30px); } 15% { opacity:0.15; } 85% { opacity:0.15; } 100% { opacity:0; transform:translateY(-100vh) rotate(15deg); } }
        .sp-particle { position:absolute; animation:floatUp linear infinite; }
        button:active { transform:scale(0.97) !important; }
      `}</style>

      {/* --- AMBIENT ELEMENTS --- */}
      <div style={{ position: 'fixed', top: '-15%', right: '-15%', width: '60vw', height: '60vh', background: ts.glowColor, filter: 'blur(140px)', borderRadius: '50%', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', bottom: '-15%', left: '-15%', width: '50vw', height: '50vh', background: ts.glowColor2, filter: 'blur(120px)', borderRadius: '50%', pointerEvents: 'none', zIndex: 0 }} />
      {selectedTemplate === 'golden_hour' && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
          {['♪','♫','♬','♩','✦'].map((n, i) => (
            <span key={i} className="sp-particle" style={{ left: `${8 + i * 17}%`, fontSize: 10 + i * 2, color: 'rgba(244,192,37,0.15)', animationDuration: `${10 + i * 2}s`, animationDelay: `${i * 1.5}s` }}>{n}</span>
          ))}
        </div>
      )}

      {/* --- MAIN CONTENT --- */}
      {revealed && (
        <div style={{
          maxWidth: '480px', margin: '0 auto', paddingTop: '28px',
          opacity: contentVisible ? 1 : 0,
          transform: contentVisible ? 'scale(1)' : 'scale(0.92)',
          transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
          position: 'relative', zIndex: 10,
        }}>

          {/* ===== HERO HEADER ===== */}
          <div style={{ textAlign: 'center', marginBottom: '32px', animation: 'fadeInUp 0.7s ease-out' }}>
            <div style={{
              fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase',
              color: isLight ? ts.accent : `rgba(${ts.accentRgb},0.5)`,
              marginBottom: '14px', fontWeight: 500,
            }}>
              {songs.length > 1 ? `🎵 ${songs.length} canciones listas` : '🎵 Tu regalo está listo'}
            </div>
            <h1 style={{
              fontSize: 'clamp(28px, 7vw, 40px)', fontWeight: '800',
              marginBottom: '14px', lineHeight: '1.05',
            }}>
              Para{' '}
              <span style={{
                color: ts.accent,
              }}>
                {recipientName}
              </span>
            </h1>
            <p style={{
              fontSize: '15px', color: ts.textSecondary,
              fontStyle: 'italic', lineHeight: '1.5'
            }}>
              {recipientName} va a escuchar su nombre en una canción por primera vez. ❤️
            </p>
          </div>

          {/* ===== PLAYER CARD ===== */}
          <div style={{
            background: ts.cardBg,
            borderRadius: '24px', padding: '28px 24px',
            border: `1px solid ${ts.cardBorder}`,
            marginBottom: '24px',
            backdropFilter: ts.cardBlur,
            animation: 'fadeInUp 0.7s ease-out 0.15s both',
            boxShadow: isLight ? `0 10px 40px -10px rgba(${ts.accentRgb},0.15)` : `0 25px 50px rgba(0,0,0,0.2)`,
          }}>
            {/* Album Art */}
            <div style={{
              width: '200px', height: '200px', margin: '0 auto 24px',
              borderRadius: '20px', overflow: 'hidden',
              position: 'relative',
              animation: isPlaying ? 'glowPulse 2.5s ease-in-out infinite' : 'none',
              background: `linear-gradient(135deg, rgba(${ts.accentRgb},0.3), rgba(${ts.accentRgb},0.1))`,
              boxShadow: `0 12px 40px rgba(0,0,0,${isLight ? '0.15' : '0.5'})`
            }}>
              {currentSong.image_url ? (
                <img src={currentSong.image_url} alt="" style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                  transition: 'transform 0.6s',
                  transform: isPlaying ? 'scale(1.05)' : 'scale(1)'
                }} onError={(e) => { e.target.style.display = 'none'; }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '72px' }}>🎵</span>
                </div>
              )}
              {/* Equalizer overlay */}
              {isPlaying && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: '60px',
                  background: `linear-gradient(transparent, rgba(0,0,0,0.85))`,
                  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                  gap: '4px', paddingBottom: '12px'
                }}>
                  {[0.55, 0.45, 0.65, 0.4, 0.7, 0.5, 0.6].map((d, i) => (
                    <div key={i} style={{
                      width: '4px', borderRadius: '2px',
                      background: ts.accent,
                      animation: `eq${(i % 4) + 1} ${d}s ease-in-out infinite`,
                      filter: selectedTemplate === 'electric_magenta' ? `drop-shadow(0 0 4px rgba(${ts.accentRgb},0.6))` : 'none',
                    }} />
                  ))}
                </div>
              )}
            </div>

            {/* Song info */}
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '6px', color: ts.textPrimary }}>
                Para {recipientName}
              </h2>
              {senderName && (
                <p style={{ fontSize: '14px', color: ts.textSecondary, margin: '0 0 6px 0' }}>
                  De: {senderName}
                </p>
              )}
              <p style={{ fontSize: '13px', color: ts.accent, margin: 0, textTransform: 'capitalize', fontWeight: '600' }}>
                {genre}{occasion ? ` • ${occasion}` : ''}
              </p>
            </div>

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              style={{
                width: '72px', height: '72px', margin: '0 auto 20px',
                borderRadius: '50%', border: 'none',
                background: ts.accentGrad,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: `0 8px 30px rgba(${ts.accentRgb},0.4)`,
                transition: 'all 0.3s'
              }}
            >
              {isPlaying ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill={ts.btnText}>
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill={ts.btnText} style={{ marginLeft: '3px' }}>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Progress bar */}
            <div onClick={handleSeek} style={{
              height: '6px', background: isLight ? `rgba(${ts.accentRgb},0.1)` : 'rgba(255,255,255,0.1)',
              borderRadius: '3px', cursor: 'pointer', marginBottom: '8px', overflow: 'hidden'
            }}>
              <div style={{
                height: '100%', background: ts.accentGrad, borderRadius: '3px',
                width: `${(currentTime / duration) * 100 || 0}%`,
                transition: 'width 0.15s linear',
                filter: selectedTemplate === 'electric_magenta' ? `drop-shadow(0 0 4px rgba(${ts.accentRgb},0.5))` : 'none',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: ts.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* ===== MULTI-SONG SELECTOR ===== */}
          {songs.length > 1 && (
            <div style={{
              background: ts.cardBg, borderRadius: '20px', padding: '18px',
              marginBottom: '24px', border: `1px solid ${ts.cardBorder}`,
              backdropFilter: ts.cardBlur,
              animation: 'fadeInUp 0.7s ease-out 0.25s both'
            }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px', textAlign: 'center', color: ts.textSecondary, letterSpacing: '1px', textTransform: 'uppercase' }}>
                Tus {songs.length} Versiones
              </h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                {songs.map((song, index) => (
                  <button key={song.id}
                    onClick={() => { setCurrentSong(song); setIsPlaying(false); setCurrentTime(0); }}
                    style={{
                      flex: 1, padding: '14px 12px', borderRadius: '14px',
                      background: currentSong.id === song.id ? `rgba(${ts.accentRgb},0.15)` : isLight ? 'white' : 'rgba(255,255,255,0.04)',
                      border: `2px solid ${currentSong.id === song.id ? ts.accent : ts.cardBorder}`,
                      color: ts.textPrimary, cursor: 'pointer', textAlign: 'center',
                      transition: 'all 0.3s', fontFamily: ts.font
                    }}>
                    <span style={{ fontSize: '14px', fontWeight: '700' }}>
                      {index === 0 ? '💫' : '🔥'} Versión {index + 1}
                    </span>
                    {currentSong.id === song.id && (
                      <span style={{ display: 'block', fontSize: '11px', color: ts.accent, marginTop: '4px', fontWeight: '600' }}>▶ Escuchando</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ===== DOWNLOAD BUTTONS ===== */}
          <div style={{ marginBottom: '24px', animation: 'fadeInUp 0.7s ease-out 0.35s both' }}>
            <button onClick={() => handleDownload(currentSong)} disabled={downloading}
              style={{
                width: '100%', padding: '18px',
                background: ts.accentGrad,
                color: ts.btnText, fontWeight: '800', fontSize: '17px',
                border: 'none', borderRadius: '16px', cursor: downloading ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                boxShadow: `0 8px 30px rgba(${ts.accentRgb},0.35)`,
                opacity: downloading ? 0.7 : 1, transition: 'all 0.3s',
                marginBottom: songs.length > 1 ? '10px' : '0',
                fontFamily: ts.font
              }}>
              {downloading ? '⏳ Descargando...' : '⬇️ Descargar MP3'}
            </button>
            {songs.length > 1 && (
              <button onClick={handleDownloadAll} disabled={downloading}
                style={{
                  width: '100%', padding: '14px',
                  background: isLight ? 'white' : 'rgba(255,255,255,0.06)',
                  color: ts.textPrimary, fontWeight: '700', fontSize: '15px',
                  border: `1.5px solid ${ts.cardBorder}`, borderRadius: '16px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'all 0.3s', fontFamily: ts.font
                }}>
                📦 Descargar Todas ({songs.length})
              </button>
            )}
          </div>

          {/* ===== VIDEO UPSELL SECTION ===== */}
          <div style={{
            background: ts.cardBg, borderRadius: '24px', padding: '24px',
            border: `1px solid ${ts.cardBorder}`, marginBottom: '24px',
            backdropFilter: ts.cardBlur,
            animation: 'fadeInUp 0.7s ease-out 0.4s both',
            overflow: 'hidden', position: 'relative',
          }}>
            {/* Decorative gradient stripe at top */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
              background: `linear-gradient(90deg, ${ts.accent}, rgba(${ts.accentRgb},0.3), ${ts.accent})`,
              backgroundSize: '200% 100%',
              animation: 'shimmerAccent 3s linear infinite',
            }} />

            {/* STATE: No video order yet — Show upsell CTA */}
            {!videoOrder && (
              <>
                <div style={{ textAlign: 'center', marginBottom: '18px' }}>
                  <span style={{ fontSize: '40px', display: 'block', marginBottom: '10px' }}>🎬</span>
                  <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px', color: ts.textPrimary }}>
                    ¡Hazlo aún más especial!
                  </h3>
                  <p style={{ fontSize: '14px', color: ts.textSecondary, lineHeight: '1.6', maxWidth: '320px', margin: '0 auto' }}>
                    Crea un <span style={{ color: ts.accent, fontWeight: '700' }}>video con fotos</span> y la canción de fondo. Efecto Ken Burns cinematográfico con texto personalizado.
                  </p>
                </div>
                <div style={{
                  display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '16px',
                  flexWrap: 'wrap'
                }}>
                  {['📸 Hasta 15 fotos', '🎵 Con tu canción', '✨ Efecto cine'].map((feat, i) => (
                    <span key={i} style={{
                      fontSize: '12px', fontWeight: '600',
                      padding: '6px 12px', borderRadius: '20px',
                      background: isLight ? `rgba(${ts.accentRgb},0.08)` : `rgba(${ts.accentRgb},0.12)`,
                      color: ts.accent, whiteSpace: 'nowrap'
                    }}>{feat}</span>
                  ))}
                </div>
                <button onClick={handleVideoPurchase} disabled={videoPurchasing}
                  style={{
                    width: '100%', padding: '18px',
                    background: `linear-gradient(135deg, #8b5cf6, #a78bfa)`,
                    color: 'white', fontWeight: '800', fontSize: '17px',
                    border: 'none', borderRadius: '16px',
                    cursor: videoPurchasing ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    boxShadow: '0 8px 30px rgba(139,92,246,0.35)',
                    opacity: videoPurchasing ? 0.7 : 1,
                    transition: 'all 0.3s', fontFamily: ts.font,
                  }}>
                  {videoPurchasing ? '⏳ Redirigiendo a pago...' : '🎬 Crear Video — $9.99 USD'}
                </button>
                {videoError && (
                  <p style={{ color: '#f87171', fontSize: '13px', textAlign: 'center', marginTop: '10px' }}>{videoError}</p>
                )}
              </>
            )}

            {/* STATE: Paid, pending photos (status: pending) */}
            {videoOrder && videoOrder.status === 'pending' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: '18px' }}>
                  <span style={{ fontSize: '36px', display: 'block', marginBottom: '10px' }}>📸</span>
                  <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px', color: ts.textPrimary }}>
                    ¡Sube tus fotos!
                  </h3>
                  <p style={{ fontSize: '14px', color: ts.textSecondary, lineHeight: '1.6' }}>
                    Selecciona de <span style={{ color: ts.accent, fontWeight: '700' }}>3 a 15 fotos</span> para tu video personalizado
                  </p>
                </div>

                {/* Photo grid */}
                {videoPhotos.length > 0 && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                    gap: '8px', marginBottom: '16px',
                  }}>
                    {videoPhotos.map((photo, i) => (
                      <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: '12px', overflow: 'hidden' }}>
                        <img src={photo.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button onClick={() => removeVideoPhoto(i)} style={{
                          position: 'absolute', top: '4px', right: '4px',
                          width: '22px', height: '22px', borderRadius: '50%',
                          background: 'rgba(0,0,0,0.7)', border: 'none', color: 'white',
                          fontSize: '11px', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                        }}>✕</button>
                        <div style={{
                          position: 'absolute', bottom: '4px', left: '4px',
                          background: 'rgba(0,0,0,0.6)', borderRadius: '8px',
                          padding: '2px 6px', fontSize: '10px', color: 'white', fontWeight: '700'
                        }}>{i + 1}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload button */}
                <input
                  ref={videoPhotoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleVideoPhotoSelect}
                  style={{ display: 'none' }}
                />

                <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                  {videoPhotos.length < 15 && (
                    <button onClick={() => videoPhotoInputRef.current?.click()}
                      style={{
                        flex: 1, padding: '14px',
                        background: isLight ? 'white' : 'rgba(255,255,255,0.06)',
                        color: ts.textPrimary, fontWeight: '700', fontSize: '15px',
                        border: `1.5px dashed ${ts.cardBorder}`, borderRadius: '14px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                        fontFamily: ts.font,
                      }}>
                      📷 {videoPhotos.length > 0 ? 'Agregar más' : 'Seleccionar fotos'}
                    </button>
                  )}
                </div>

                {/* Photo count indicator */}
                <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                  <span style={{
                    fontSize: '13px', fontWeight: '600',
                    color: videoPhotos.length >= 3 ? '#22c55e' : ts.textSecondary,
                  }}>
                    {videoPhotos.length >= 3 ? '✅' : '⚠️'} {videoPhotos.length}/15 fotos
                    {videoPhotos.length < 3 && ` (mínimo 3)`}
                  </span>
                </div>

                {/* Generate button */}
                <button
                  onClick={handleVideoGenerate}
                  disabled={videoPhotos.length < 3 || uploadingVideoPics}
                  style={{
                    width: '100%', padding: '18px',
                    background: videoPhotos.length >= 3
                      ? 'linear-gradient(135deg, #8b5cf6, #a78bfa)'
                      : isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)',
                    color: videoPhotos.length >= 3 ? 'white' : ts.textSecondary,
                    fontWeight: '800', fontSize: '17px',
                    border: 'none', borderRadius: '16px',
                    cursor: videoPhotos.length >= 3 && !uploadingVideoPics ? 'pointer' : 'not-allowed',
                    opacity: uploadingVideoPics ? 0.7 : 1,
                    transition: 'all 0.3s', fontFamily: ts.font,
                    boxShadow: videoPhotos.length >= 3 ? '0 8px 30px rgba(139,92,246,0.35)' : 'none',
                  }}>
                  {uploadingVideoPics ? '📤 Subiendo fotos...' : '🎬 Generar Video'}
                </button>

                {videoError && (
                  <p style={{ color: '#f87171', fontSize: '13px', textAlign: 'center', marginTop: '10px' }}>{videoError}</p>
                )}
              </>
            )}

            {/* STATE: Photos uploaded, processing */}
            {videoOrder && (videoOrder.status === 'photos_uploaded' || videoOrder.status === 'processing') && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{
                  width: '64px', height: '64px', margin: '0 auto 18px',
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, rgba(139,92,246,0.2), rgba(139,92,246,0.05))`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'pulse 2s ease-in-out infinite',
                }}>
                  <span style={{ fontSize: '28px' }}>🎬</span>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px', color: ts.textPrimary }}>
                  Generando tu video...
                </h3>
                <p style={{ fontSize: '14px', color: ts.textSecondary, lineHeight: '1.6', marginBottom: '16px' }}>
                  Estamos creando tu video con efecto cinematográfico. Esto puede tomar unos minutos.
                </p>
                <div style={{
                  width: '100%', height: '6px', borderRadius: '3px',
                  background: isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: '60%', height: '100%', borderRadius: '3px',
                    background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)',
                    animation: 'shimmerAccent 2s linear infinite',
                    backgroundSize: '200% 100%',
                  }} />
                </div>
                <p style={{ fontSize: '12px', color: ts.textSecondary, marginTop: '12px' }}>
                  Te notificaremos por email cuando esté listo
                </p>
              </div>
            )}

            {/* STATE: Completed — Show video player + download */}
            {videoOrder && videoOrder.status === 'completed' && videoOrder.video_url && (
              <>
                <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                  <span style={{ fontSize: '36px', display: 'block', marginBottom: '8px' }}>🎉</span>
                  <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '6px', color: ts.textPrimary }}>
                    ¡Tu video está listo!
                  </h3>
                </div>
                <div style={{
                  borderRadius: '16px', overflow: 'hidden', marginBottom: '16px',
                  boxShadow: `0 12px 40px rgba(0,0,0,${isLight ? '0.15' : '0.5'})`,
                }}>
                  <video
                    src={videoOrder.video_url}
                    controls
                    style={{ width: '100%', display: 'block', borderRadius: '16px' }}
                    poster=""
                  />
                </div>
                <button onClick={handleVideoDownload}
                  style={{
                    width: '100%', padding: '16px',
                    background: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
                    color: 'white', fontWeight: '800', fontSize: '16px',
                    border: 'none', borderRadius: '16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    boxShadow: '0 8px 30px rgba(139,92,246,0.35)',
                    transition: 'all 0.3s', fontFamily: ts.font,
                  }}>
                  ⬇️ Descargar Video MP4
                </button>
              </>
            )}

            {/* STATE: Failed */}
            {videoOrder && videoOrder.status === 'failed' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <span style={{ fontSize: '36px', display: 'block', marginBottom: '10px' }}>😔</span>
                <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px', color: ts.textPrimary }}>
                  Error al generar el video
                </h3>
                <p style={{ fontSize: '13px', color: '#f87171', marginBottom: '16px' }}>
                  {videoOrder.error_message || 'Ocurrió un error. Contáctanos para ayuda.'}
                </p>
                <a href="mailto:soporte@regalosquecantan.com" style={{
                  color: ts.accent, fontSize: '14px', fontWeight: '600', textDecoration: 'underline',
                }}>
                  📧 Contactar soporte
                </a>
              </div>
            )}
          </div>

          {/* ===== SHARE SECTION ===== */}
          <div style={{
            background: ts.cardBg, borderRadius: '24px', padding: '24px',
            border: `1px solid ${ts.cardBorder}`, marginBottom: '24px',
            backdropFilter: ts.cardBlur,
            animation: 'fadeInUp 0.7s ease-out 0.45s both'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '18px', textAlign: 'center', color: ts.textPrimary }}>
              💝 Comparte el regalo
            </h3>
            {/* Mini preview card */}
            <div style={{
              background: isLight ? `rgba(${ts.accentRgb},0.04)` : `rgba(${ts.accentRgb},0.08)`,
              borderRadius: '16px', padding: '18px', textAlign: 'center', marginBottom: '18px',
              border: `1.5px solid rgba(${ts.accentRgb},0.15)`,
            }}>
              <div style={{
                width: '64px', height: '64px', margin: '0 auto 10px',
                borderRadius: '12px', overflow: 'hidden',
                background: `linear-gradient(135deg, rgba(${ts.accentRgb},0.3), rgba(${ts.accentRgb},0.1))`
              }}>
                {currentSong.image_url ? (
                  <img src={currentSong.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { e.target.parentElement.innerHTML = '<span style="font-size:32px;display:flex;align-items:center;justify-content:center;height:100%">🎵</span>'; }} />
                ) : (
                  <span style={{ fontSize: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>🎵</span>
                )}
              </div>
              <p style={{ fontSize: '15px', fontWeight: '700', margin: '0 0 4px 0', color: ts.accent }}>
                🎵 {songs.length > 1 ? `${songs.length} canciones` : 'Una canción'} para {recipientName}
              </p>
              <p style={{ fontSize: '12px', color: ts.textSecondary, margin: 0 }}>
                Creada especialmente — hecha con ❤️
              </p>
              {songUrl && (
                <p style={{ fontSize: '10px', color: isLight ? '#94a3b8' : 'rgba(255,255,255,0.25)', margin: '8px 0 0', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  {songUrl}
                </p>
              )}
            </div>
            {/* Share buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={handleShareWhatsApp}
                style={{
                  flex: 1, padding: '14px', background: '#25D366', color: 'white',
                  border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '700',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  boxShadow: '0 4px 15px rgba(37,211,102,0.3)', transition: 'all 0.3s', fontFamily: ts.font
                }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                WhatsApp
              </button>
              <button onClick={handleCopyLink}
                style={{
                  flex: 1, padding: '14px',
                  background: linkCopied ? 'rgba(34,197,94,0.15)' : isLight ? 'white' : 'rgba(255,255,255,0.06)',
                  color: linkCopied ? '#4ade80' : ts.textPrimary,
                  border: `1.5px solid ${linkCopied ? '#22c55e' : ts.cardBorder}`,
                  borderRadius: '14px', fontSize: '15px', fontWeight: '700',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'all 0.3s', fontFamily: ts.font
                }}>
                {linkCopied ? '✓ ¡Copiado!' : '🔗 Copiar Link'}
              </button>
            </div>
          </div>

          {/* ===== TEMPLATE DESIGN PICKER (compact strip) ===== */}
          <div style={{
            background: ts.cardBg, borderRadius: '20px', padding: '18px',
            border: `1px solid ${ts.cardBorder}`, marginBottom: '24px',
            backdropFilter: ts.cardBlur,
            animation: 'fadeInUp 0.7s ease-out 0.55s both'
          }}>
            <p style={{ fontSize: '12px', color: ts.textSecondary, textAlign: 'center', marginBottom: '12px', fontWeight: 600 }}>
              🎨 Cambiar diseño de la página
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { id: 'golden_hour', label: 'Golden Hour', icon: '🌅', color: '#f4c025', bg: 'linear-gradient(160deg, #1a1408, #2a1f10)' },
                { id: 'lavender_dream', label: 'Lavender Dream', icon: '💜', color: '#9947eb', bg: 'radial-gradient(circle, #fdfbf7, #f0e9f7)' },
                { id: 'electric_magenta', label: 'Electric Magenta', icon: '⚡', color: '#f20d59', bg: '#0a0507' },
              ].map((t) => {
                const isActive = selectedTemplate === t.id;
                return (
                  <button key={t.id} onClick={() => setSelectedTemplate(t.id)}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: '12px', cursor: 'pointer',
                      border: `2px solid ${isActive ? t.color : 'rgba(128,128,128,0.15)'}`,
                      background: t.bg, overflow: 'hidden', transition: 'all 0.25s',
                      opacity: isActive ? 1 : 0.5,
                      transform: isActive ? 'scale(1.05)' : 'scale(1)',
                      position: 'relative',
                    }}>
                    <div style={{ fontSize: '18px', textAlign: 'center', marginBottom: '3px' }}>{t.icon}</div>
                    <div style={{ fontSize: '8px', fontWeight: 700, textAlign: 'center', color: isActive ? t.color : 'rgba(200,200,200,0.6)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</div>
                    {isActive && <div style={{ position: 'absolute', top: 3, right: 3, width: 12, height: 12, borderRadius: '50%', background: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white' }}>✓</div>}
                  </button>
                );
              })}
            </div>

            {/* Photo upload — only for photo templates */}
            {(selectedTemplate === 'lavender_dream' || selectedTemplate === 'electric_magenta') && (
              <div style={{
                background: isLight ? 'rgba(153,71,235,0.04)' : 'rgba(255,255,255,0.04)',
                border: `1.5px dashed ${isLight ? 'rgba(153,71,235,0.2)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: '16px', padding: '18px',
                textAlign: 'center', marginTop: '14px',
              }}>
                <p style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: ts.textPrimary }}>
                  📸 Agrega una foto (opcional)
                </p>
                <p style={{ fontSize: '11px', color: ts.textSecondary, marginBottom: '14px' }}>
                  Se mostrará en la página cuando {recipientName} abra el link
                </p>
                {photoPreview ? (
                  <div style={{ position: 'relative', display: 'inline-block', marginBottom: '12px' }}>
                    <img src={photoPreview} alt="" style={{
                      width: '120px', height: '120px', objectFit: 'cover',
                      borderRadius: '12px', border: `2px solid rgba(${ts.accentRgb},0.3)`
                    }} />
                    <button onClick={() => { setPhotoFile(null); setPhotoPreview(null); }} style={{
                      position: 'absolute', top: '-8px', right: '-8px',
                      width: '24px', height: '24px', borderRadius: '50%',
                      background: '#e11d48', border: 'none', color: 'white',
                      fontSize: '12px', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}>✕</button>
                  </div>
                ) : (
                  <label style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: '10px 20px', borderRadius: '12px',
                    background: isLight ? 'white' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${ts.cardBorder}`,
                    cursor: 'pointer', fontSize: '14px', fontWeight: '600',
                    color: ts.textSecondary, fontFamily: ts.font,
                  }}>
                    📷 Elegir foto
                    <input type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: 'none' }} />
                  </label>
                )}
              </div>
            )}

            {/* Save button */}
            <button onClick={handleSaveTemplate} disabled={savingTemplate}
              style={{
                width: '100%', padding: '14px', marginTop: '14px',
                background: templateSaved ? 'rgba(34,197,94,0.2)' : ts.accentGrad,
                border: templateSaved ? '1.5px solid #22c55e' : 'none',
                borderRadius: '14px',
                color: templateSaved ? '#4ade80' : ts.btnText,
                fontSize: '15px', fontWeight: '700',
                cursor: savingTemplate ? 'wait' : 'pointer',
                opacity: savingTemplate ? 0.7 : 1,
                transition: 'all 0.3s', fontFamily: ts.font,
              }}>
              {savingTemplate ? (uploadingPhoto ? '📤 Subiendo foto...' : '💾 Guardando...') : templateSaved ? '✅ ¡Guardado!' : '💾 Guardar diseño'}
            </button>

            {/* Preview link */}
            {templateSaved && songUrl && (
              <div style={{ marginTop: '12px', textAlign: 'center' }}>
                <a href={songUrl} target="_blank" rel="noopener noreferrer"
                  style={{ color: ts.accent, fontSize: '13px', fontWeight: '600', textDecoration: 'underline' }}>
                  👁️ Ver cómo se ve →
                </a>
              </div>
            )}
          </div>

          {/* ===== HOW TO GIFT ===== */}
          <div style={{
            background: ts.cardBg, borderRadius: '24px', padding: '24px',
            border: `1px solid ${ts.cardBorder}`, marginBottom: '24px',
            backdropFilter: ts.cardBlur,
            animation: 'fadeInUp 0.7s ease-out 0.6s both'
          }}>
            <h3 style={{ fontSize: '17px', fontWeight: '800', marginBottom: '20px', textAlign: 'center', color: ts.textPrimary }}>
              🎁 ¿Cómo regalarlo?
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                { icon: '⬇️', title: 'Descarga la canción', desc: 'Toca el botón de descargar arriba' },
                { icon: '💬', title: 'Envíala por WhatsApp', desc: 'Comparte el archivo o link con un mensaje especial' },
                { icon: '😭❤️', title: 'Mira su reacción', desc: `¡${recipientName} no lo va a creer!` }
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '46px', height: '46px', minWidth: '46px', borderRadius: '50%',
                    background: i === 2 ? ts.accentGrad : isLight ? 'white' : 'rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px',
                    border: i === 2 ? 'none' : `1.5px solid ${ts.cardBorder}`,
                    boxShadow: i === 2 ? `0 4px 15px rgba(${ts.accentRgb},0.3)` : 'none'
                  }}>
                    {item.icon}
                  </div>
                  <div>
                    <p style={{ fontSize: '15px', fontWeight: '700', margin: '0 0 2px 0', color: ts.textPrimary }}>{item.title}</p>
                    <p style={{ fontSize: '13px', color: ts.textSecondary, margin: 0 }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== FOOTER ===== */}
          <div style={{ textAlign: 'center', marginBottom: '24px', animation: 'fadeInUp 0.7s ease-out 0.65s both' }}>
            <p style={{
              fontSize: '15px', color: ts.textSecondary,
              fontStyle: 'italic', lineHeight: '1.7',
              maxWidth: '340px', margin: '0 auto'
            }}>
              "De todas las cosas que puedes regalar, una canción con su nombre es algo que {recipientName} va a recordar para siempre."
            </p>
          </div>

          <div style={{ textAlign: 'center', animation: 'fadeInUp 0.7s ease-out 0.75s both' }}>
            <a href="/" style={{ color: ts.textSecondary, textDecoration: 'none', fontSize: '14px', fontWeight: '600' }}>
              ← Crear otra canción
            </a>
          </div>

          <p style={{ textAlign: 'center', marginTop: '30px', color: isLight ? '#94a3b8' : 'rgba(255,255,255,0.2)', fontSize: '10px', lineHeight: 1.6, maxWidth: 340, margin: '30px auto 0' }}>
            Todas las ventas son finales. Al comprar, aceptas que escuchaste la vista previa antes de realizar tu compra. No se ofrecen reembolsos una vez completada la transacción.
          </p>
          <p style={{ textAlign: 'center', marginTop: '12px', color: isLight ? '#cbd5e1' : 'rgba(255,255,255,0.15)', fontSize: '11px' }}>
            RegalosQueCantan © {new Date().getFullYear()}
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SHARED STYLES
// ============================================================
const S = {
  fullScreenCenter: {
    background: 'linear-gradient(160deg, #110d0f 0%, #181114 35%, #1e1519 65%, #151015 100%)',
    color: 'white',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Montserrat', sans-serif"
  }
};
