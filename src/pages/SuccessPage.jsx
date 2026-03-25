import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Inlined video API helpers
async function createVideoCheckout(songId, email) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-video-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ songId, email }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function checkVideoStatus(songId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/check-video-status?songId=${songId}`, {
    headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function generateVideo(videoOrderId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ videoOrderId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

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
  const [downloadComplete, setDownloadComplete] = useState({});
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
  const [selectedVideoSongIdx, setSelectedVideoSongIdx] = useState(0);
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

  // ------ Fallback: verify payment with Stripe if webhook failed ------
  const hasVerifiedPayment = useRef(false);
  useEffect(() => {
    if (hasVerifiedPayment.current) return;
    if (!songs.length) return;

    const sessionId = urlParams.get('session_id');
    const songId = urlParams.get('song_id') || urlParams.get('song_ids');
    if (!sessionId || !songId) return;

    // Check if song is already marked as paid
    const firstSong = songs[0];
    if (firstSong?.paid) return;

    hasVerifiedPayment.current = true;

    // Song is not paid but we have a session_id — webhook likely failed
    // Call verify-payment to confirm with Stripe and update DB
    const verifyPayment = async () => {
      try {
        console.log('[Payment Verify] Webhook may have failed, verifying payment with Stripe...');
        const songIds = songId.split(',').filter(id => id.trim());
        let anyVerified = false;
        for (const sid of songIds) {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ sessionId, songId: sid })
          });
          const result = await res.json();
          console.log('[Payment Verify] Result for', sid, ':', result);
          if (result.success) anyVerified = true;
        }
        // Reload songs from DB so the UI reflects the updated paid status
        if (anyVerified) {
          console.log('[Payment Verify] Payment confirmed, reloading songs...');
          await loadSongs();
        }
      } catch (err) {
        console.error('[Payment Verify] Error:', err);
      }
    };
    verifyPayment();
  }, [songs]);

  // ------ 🔥 META PIXEL: Track Purchase after Stripe payment ------
  // Guard uses sessionStorage keyed by Stripe session_id so the pixel
  // fires exactly ONCE per checkout — survives page reloads, redirects,
  // back-button, and mobile browser app-switching.
  useEffect(() => {
    if (!songs.length) return;

    // Only fire if coming from Stripe (session_id present)
    const sessionId = urlParams.get('session_id');
    if (!sessionId) return;

    // Deduplicate: check if we already fired for this exact checkout
    const storageKey = `rqc_purchase_fired_${sessionId}`;
    if (sessionStorage.getItem(storageKey)) {
      console.log('[Meta Pixel] Purchase already fired for session:', sessionId, '— skipped');
      return;
    }
    sessionStorage.setItem(storageKey, Date.now().toString());

    // Determine purchase value based on number of songs
    const purchaseValue = songs.length > 1 ? 39.99 : 24.99;

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
      console.log('[Meta Pixel] Purchase event fired:', purchaseValue, 'USD for session:', sessionId);
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

  // Genre image fallback (Pollinations often fails)
  const getGenreImage = (genreKey) => {
    const fallbacks = { vals: 'bolero', romantica: 'balada', otro: 'balada' };
    const g = fallbacks[genreKey] || genreKey;
    return `/images/album-art/${g}.jpg`;
  };
  const handleAlbumArtError = (e) => {
    const fallback = getGenreImage(currentSong?.genre);
    if (e.target.src !== window.location.origin + fallback) {
      e.target.src = fallback;
    } else {
      e.target.style.display = 'none';
    }
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
      setDownloadComplete(prev => ({ ...prev, [target.id]: true }));
    } catch (err) {
      window.open(target.audio_url, '_blank');
      setDownloadComplete(prev => ({ ...prev, [target.id]: true }));
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
    const songId = songs[selectedVideoSongIdx]?.id;
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
      const selectedSong = songs[selectedVideoSongIdx];
      const res = await createVideoCheckout(selectedSong.id, selectedSong.email || '');
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
      startVideoPolling(songs[selectedVideoSongIdx].id);

    } catch (err) {
      console.error('Video generation error:', err);
      setVideoError(err.message || 'Error al generar el video. Intenta de nuevo.');
      setUploadingVideoPics(false);
      setVideoGenerating(false);
    }
  };

  // ------ VIDEO UPSELL: Download handler ------
  const handleVideoDownload = () => {
    if (!videoOrder?.video_url) return;
    // Use a direct link — works for both same-origin (Supabase) and cross-origin (Shotstack) URLs
    const a = document.createElement('a');
    a.href = videoOrder.video_url;
    a.download = `video-para-${recipientName || 'ti'}.mp4`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
              <img
                src={currentSong.image_url || getGenreImage(currentSong?.genre)}
                alt=""
                style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                  transition: 'transform 0.6s',
                  transform: isPlaying ? 'scale(1.05)' : 'scale(1)'
                }}
                onError={handleAlbumArtError}
              />
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

          {/* ===== DOWNLOAD & SHARE SECTION ===== */}
          <div style={{ marginBottom: '24px', animation: 'fadeInUp 0.7s ease-out 0.35s both' }}>

            {/* Step indicator header */}
            <div style={{
              textAlign: 'center', marginBottom: '16px',
              padding: '12px 16px',
              background: isLight ? `rgba(${ts.accentRgb},0.06)` : `rgba(${ts.accentRgb},0.1)`,
              borderRadius: '14px',
              border: `1px solid ${isLight ? `rgba(${ts.accentRgb},0.12)` : `rgba(${ts.accentRgb},0.2)`}`
            }}>
              <p style={{ fontSize: '15px', fontWeight: '800', margin: '0 0 4px 0', color: ts.accent }}>
                {downloadComplete[currentSong?.id] ? '✅ ¡Canción descargada!' : '👇 Paso 1: Descarga tu canción'}
              </p>
              <p style={{ fontSize: '12px', color: ts.textSecondary, margin: 0 }}>
                {downloadComplete[currentSong?.id]
                  ? 'Revisa tu carpeta de descargas · Ahora envíala por WhatsApp 👇'
                  : 'Toca el botón para guardar el MP3 en tu teléfono o computadora'}
              </p>
            </div>

            {/* Main download button */}
            <button onClick={() => handleDownload(currentSong)} disabled={downloading}
              style={{
                width: '100%', padding: '20px',
                background: downloadComplete[currentSong?.id]
                  ? (isLight ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'linear-gradient(135deg, #22c55e, #16a34a)')
                  : ts.accentGrad,
                color: downloadComplete[currentSong?.id] ? 'white' : ts.btnText,
                fontWeight: '800', fontSize: '18px',
                border: 'none', borderRadius: '16px', cursor: downloading ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                boxShadow: downloadComplete[currentSong?.id]
                  ? '0 8px 30px rgba(34,197,94,0.35)'
                  : `0 8px 30px rgba(${ts.accentRgb},0.35)`,
                opacity: downloading ? 0.7 : 1, transition: 'all 0.3s',
                marginBottom: '10px',
                fontFamily: ts.font
              }}>
              {downloading ? '⏳ Descargando...' : downloadComplete[currentSong?.id] ? '✅ Descargar de Nuevo' : '⬇️ Descargar MP3'}
            </button>

            {/* Download All button for multiple songs */}
            {songs.length > 1 && (
              <button onClick={handleDownloadAll} disabled={downloading}
                style={{
                  width: '100%', padding: '14px',
                  background: isLight ? 'white' : 'rgba(255,255,255,0.06)',
                  color: ts.textPrimary, fontWeight: '700', fontSize: '15px',
                  border: `1.5px solid ${ts.cardBorder}`, borderRadius: '16px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'all 0.3s', fontFamily: ts.font,
                  marginBottom: '10px'
                }}>
                📦 Descargar Todas ({songs.length})
              </button>
            )}

            {/* WhatsApp Share - Step 2 */}
            <div style={{
              textAlign: 'center', marginTop: '16px',
              padding: '12px 16px',
              background: isLight ? 'rgba(37,211,102,0.06)' : 'rgba(37,211,102,0.1)',
              borderRadius: '14px',
              border: `1px solid rgba(37,211,102,${downloadComplete[currentSong?.id] ? '0.35' : '0.15'})`
            }}>
              <p style={{ fontSize: '15px', fontWeight: '800', margin: '0 0 4px 0', color: '#25d366' }}>
                {downloadComplete[currentSong?.id] ? '👇 Paso 2: Envía la canción' : '💬 Paso 2: Envía por WhatsApp'}
              </p>
              <p style={{ fontSize: '12px', color: ts.textSecondary, margin: '0 0 12px 0' }}>
                Comparte el enlace para que {currentSong?.recipient_name || 'tu ser querido'} escuche su canción
              </p>
              <button onClick={handleShareWhatsApp}
                style={{
                  width: '100%', padding: '16px',
                  background: 'linear-gradient(135deg, #25d366, #128c7e)',
                  color: 'white', fontWeight: '800', fontSize: '16px',
                  border: 'none', borderRadius: '14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  boxShadow: '0 6px 25px rgba(37,211,102,0.35)',
                  transition: 'all 0.3s', fontFamily: ts.font
                }}>
                💬 Enviar por WhatsApp
              </button>
            </div>

            {/* Helpful tip */}
            <div style={{
              textAlign: 'center', marginTop: '14px',
              padding: '10px 14px',
              background: isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)',
              borderRadius: '12px'
            }}>
              <p style={{ fontSize: '12px', color: ts.textSecondary, margin: 0, lineHeight: '1.5' }}>
                💡 <strong>¿No encuentras el archivo?</strong> Revisa tu carpeta de <strong>Descargas</strong> o busca "cancion-para-{currentSong?.recipient_name || ''}" en tus archivos. También puedes enviar directamente el enlace por WhatsApp.
              </p>
            </div>
          </div>

          {/* ===== VIDEO UPSELL SECTION ===== */}
          <div style={{
            borderRadius: '24px', padding: '24px',
            border: '1px solid rgba(139,92,246,0.25)',
            marginBottom: '24px',
            background: isLight
              ? 'linear-gradient(160deg, #f5f0ff 0%, #ede8ff 100%)'
              : 'linear-gradient(160deg, rgba(109,40,217,0.14) 0%, rgba(79,70,229,0.07) 50%, rgba(0,0,0,0) 100%)',
            backdropFilter: ts.cardBlur,
            animation: 'fadeInUp 0.7s ease-out 0.4s both',
            overflow: 'hidden', position: 'relative',
            boxShadow: isLight ? '0 8px 30px rgba(124,58,237,0.1)' : '0 8px 40px rgba(109,40,217,0.12)',
          }}>
            {/* Shimmer top border */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
              background: 'linear-gradient(90deg, transparent, #8b5cf6, #a78bfa, #8b5cf6, transparent)',
              backgroundSize: '200% 100%',
              animation: 'shimmerAccent 3s linear infinite',
            }} />

            {/* STATE: No video order yet — Show upsell CTA */}
            {!videoOrder && (
              <>
                {/* Film strip decoration */}
                <div style={{ display: 'flex', gap: '3px', marginBottom: '18px', overflow: 'hidden', height: '6px', opacity: 0.35 }}>
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} style={{ flex: 1, borderRadius: '2px', background: i % 3 === 0 ? '#8b5cf6' : 'rgba(139,92,246,0.25)' }} />
                  ))}
                </div>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '20px' }}>
                  <div style={{
                    width: '54px', height: '54px', minWidth: '54px', borderRadius: '16px',
                    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '26px',
                    boxShadow: '0 8px 24px rgba(124,58,237,0.4)',
                    flexShrink: 0,
                  }}>🎬</div>
                  <div>
                    <h3 style={{ fontSize: '26px', fontWeight: '900', marginBottom: '8px', color: isLight ? '#4c1d95' : '#e9d5ff', lineHeight: 1.15, letterSpacing: '-0.03em' }}>
                      Ya tienes la canción... ahora hazla inolvidable
                    </h3>
                    <p style={{ fontSize: '14px', color: ts.textSecondary, lineHeight: '1.5', margin: '0 0 10px' }}>
                      Convierte su canción en un video con sus fotos favoritas. El regalo que los hará llorar de emoción 🥹
                    </p>
                    <p style={{ fontSize: '12px', color: '#a78bfa', fontWeight: '600', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '14px' }}>💜</span> Ya 2,400+ familias han creado su video personalizado
                    </p>
                  </div>
                </div>

                {/* Video preview mockup — Ken Burns style demo */}
                <div style={{
                  position: 'relative', borderRadius: '16px', overflow: 'hidden',
                  marginBottom: '24px', aspectRatio: '16/9',
                  border: `2px solid rgba(139,92,246,0.3)`,
                  boxShadow: '0 8px 32px rgba(124,58,237,0.25)',
                  background: '#0a0015',
                }}>
                  {/* Animated Ken Burns slideshow with sample images */}
                  <style>{`
                    @keyframes kenBurns1 { 0%{transform:scale(1) translate(0,0);opacity:1} 12.5%{transform:scale(1.12) translate(-2%,1%);opacity:1} 14.3%{opacity:0} 100%{opacity:0} }
                    @keyframes kenBurns2 { 0%{opacity:0} 12.5%{opacity:0} 14.3%{transform:scale(1.08) translate(2%,-1%);opacity:1} 26.8%{transform:scale(1.2) translate(-1%,2%);opacity:1} 28.6%{opacity:0} 100%{opacity:0} }
                    @keyframes kenBurns3 { 0%{opacity:0} 26.8%{opacity:0} 28.6%{transform:scale(1) translate(-1%,0);opacity:1} 41.1%{transform:scale(1.15) translate(2%,-2%);opacity:1} 42.9%{opacity:0} 100%{opacity:0} }
                    @keyframes kenBurns4 { 0%{opacity:0} 41.1%{opacity:0} 42.9%{transform:scale(1.05) translate(0,1%);opacity:1} 55.4%{transform:scale(1.18) translate(-3%,2%);opacity:1} 57.1%{opacity:0} 100%{opacity:0} }
                    @keyframes kenBurns5 { 0%{opacity:0} 55.4%{opacity:0} 57.1%{transform:scale(1) translate(1%,0);opacity:1} 69.6%{transform:scale(1.14) translate(-2%,-1%);opacity:1} 71.4%{opacity:0} 100%{opacity:0} }
                    @keyframes kenBurns6 { 0%{opacity:0} 69.6%{opacity:0} 71.4%{transform:scale(1.1) translate(1%,1%);opacity:1} 83.9%{transform:scale(1.2) translate(-2%,0);opacity:1} 85.7%{opacity:0} 100%{opacity:0} }
                    @keyframes kenBurns7 { 0%{opacity:0} 83.9%{opacity:0} 85.7%{transform:scale(1.05) translate(0,-1%);opacity:1} 98.2%{transform:scale(1.16) translate(2%,1%);opacity:1} 100%{opacity:0} }
                    @keyframes progressPreview { 0%{width:0%} 100%{width:100%} }
                    @keyframes noteFloat { 0%{transform:translateY(0) rotate(0deg);opacity:0.7} 50%{transform:translateY(-8px) rotate(10deg);opacity:1} 100%{transform:translateY(0) rotate(0deg);opacity:0.7} }
                  `}</style>

                  {/* Emotional: couples, family, hugging, celebrations */}
                  {[
                    'https://images.unsplash.com/photo-1543342384-1f1350e27861?w=600&h=340&fit=crop',
                    'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=600&h=340&fit=crop',
                    'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=600&h=340&fit=crop',
                    'https://images.unsplash.com/photo-1581952976147-5a2d15560349?w=600&h=340&fit=crop',
                    'https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?w=600&h=340&fit=crop',
                    'https://images.unsplash.com/photo-1609220136736-443140cffec6?w=600&h=340&fit=crop',
                    'https://images.unsplash.com/photo-1494774157365-9e04c6720e47?w=600&h=340&fit=crop',
                  ].map((src, i) => (
                    <img key={i} src={src} alt="" style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                      animation: `kenBurns${i + 1} 28s ease-in-out infinite`,
                      opacity: i === 0 ? 1 : 0,
                    }} />
                  ))}

                  {/* Gradient overlay for cinematic feel */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(180deg, rgba(10,0,21,0) 50%, rgba(10,0,21,0.7) 100%)',
                    pointerEvents: 'none',
                  }} />

                  {/* Floating music notes */}
                  <div style={{ position: 'absolute', top: '12px', right: '14px', display: 'flex', gap: '8px' }}>
                    {['🎵', '🎶'].map((n, i) => (
                      <span key={i} style={{
                        fontSize: '18px', opacity: 0.7,
                        animation: `noteFloat 2s ease-in-out ${i * 0.7}s infinite`,
                      }}>{n}</span>
                    ))}
                  </div>

                  {/* Play button overlay */}
                  <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: 'rgba(124,58,237,0.85)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 20px rgba(124,58,237,0.5)',
                  }}>
                    <span style={{ fontSize: '22px', marginLeft: '3px', color: 'white' }}>▶</span>
                  </div>

                  {/* Bottom info bar */}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'linear-gradient(180deg, transparent, rgba(10,0,21,0.9))',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', color: '#c4b5fd', fontWeight: 700 }}>Vista previa</span>
                      <span style={{ fontSize: '11px', color: 'rgba(196,181,253,0.6)' }}>•</span>
                      <span style={{ fontSize: '11px', color: 'rgba(196,181,253,0.6)' }}>Tus fotos + su canción</span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#a78bfa', fontWeight: 600, background: 'rgba(124,58,237,0.3)', padding: '3px 8px', borderRadius: '6px' }}>HD 1080p</span>
                  </div>

                  {/* Animated progress bar at very bottom */}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'rgba(124,58,237,0.2)' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg, #7c3aed, #a78bfa)', animation: 'progressPreview 28s linear infinite' }} />
                  </div>
                </div>

                {/* How it works — 2 easy steps */}
                <div style={{ marginBottom: '24px' }}>
                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', textAlign: 'center' }}>Así de fácil</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                    {/* Step 1 */}
                    <div style={{
                      flex: 1, display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '12px 14px', borderRadius: '14px',
                      background: isLight ? 'rgba(139,92,246,0.07)' : 'rgba(139,92,246,0.1)',
                    }}>
                      <div style={{
                        width: '38px', height: '38px', minWidth: '38px', borderRadius: '12px',
                        background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '18px', boxShadow: '0 4px 12px rgba(124,58,237,0.35)',
                      }}>📸</div>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: '800', color: isLight ? '#4c1d95' : '#e9d5ff', margin: 0, lineHeight: 1.2 }}>Sube tus fotos</p>
                        <p style={{ fontSize: '11px', color: ts.textSecondary, margin: '2px 0 0', lineHeight: 1.3 }}>Los momentos especiales</p>
                      </div>
                    </div>
                    {/* Arrow connector */}
                    <div style={{ padding: '0 6px', fontSize: '16px', color: '#7c3aed', fontWeight: '900', flexShrink: 0 }}>→</div>
                    {/* Step 2 */}
                    <div style={{
                      flex: 1, display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '12px 14px', borderRadius: '14px',
                      background: isLight ? 'rgba(139,92,246,0.07)' : 'rgba(139,92,246,0.1)',
                    }}>
                      <div style={{
                        width: '38px', height: '38px', minWidth: '38px', borderRadius: '12px',
                        background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '18px', boxShadow: '0 4px 12px rgba(124,58,237,0.35)',
                      }}>✨</div>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: '800', color: isLight ? '#4c1d95' : '#e9d5ff', margin: 0, lineHeight: 1.2 }}>Recibe tu video</p>
                        <p style={{ fontSize: '11px', color: ts.textSecondary, margin: '2px 0 0', lineHeight: 1.3 }}>Canción + fotos = magia</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Song selector for combo purchases */}
                {songs.length > 1 && !videoOrder && (
                  <div style={{
                    marginBottom: '20px', padding: '12px 14px', borderRadius: '12px',
                    background: isLight ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.1)',
                    border: `1px solid ${isLight ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.2)'}`,
                  }}>
                    <p style={{ fontSize: '12px', fontWeight: '700', color: isLight ? '#4c1d95' : '#c4b5fd', margin: '0 0 8px' }}>
                      🎵 ¿Para cuál canción quieres el video?
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {songs.map((song, i) => (
                        <button key={song.id} onClick={() => setSelectedVideoSongIdx(i)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '10px 12px', borderRadius: '10px',
                            background: selectedVideoSongIdx === i
                              ? (isLight ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.2)')
                              : (isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.04)'),
                            border: selectedVideoSongIdx === i
                              ? '2px solid rgba(124,58,237,0.5)'
                              : `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}`,
                            cursor: 'pointer', fontFamily: ts.font, textAlign: 'left',
                            transition: 'all 0.2s',
                          }}>
                          <span style={{
                            width: '20px', height: '20px', borderRadius: '50%',
                            border: selectedVideoSongIdx === i ? '2px solid #7c3aed' : `2px solid ${isLight ? '#ccc' : '#555'}`,
                            background: selectedVideoSongIdx === i ? '#7c3aed' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            {selectedVideoSongIdx === i && <span style={{ color: 'white', fontSize: '11px' }}>✓</span>}
                          </span>
                          <div>
                            <p style={{ fontSize: '13px', fontWeight: '700', color: ts.textPrimary, margin: 0 }}>
                              {song.recipientName ? `Para ${song.recipientName}` : `Canción ${i + 1}`}
                            </p>
                            <p style={{ fontSize: '11px', color: ts.textSecondary, margin: 0 }}>
                              {song.occasion || song.genre || 'Canción personalizada'}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Price strip — deal pricing */}
                <div style={{
                  background: isLight ? 'linear-gradient(135deg, rgba(109,40,217,0.08), rgba(79,70,229,0.04))' : 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(79,70,229,0.08))',
                  border: '1px solid rgba(139,92,246,0.25)',
                  borderRadius: '16px', padding: '16px 18px', marginBottom: '20px',
                  position: 'relative', overflow: 'hidden',
                }}>
                  {/* Sale badge */}
                  <div style={{
                    position: 'absolute', top: '10px', right: '-28px',
                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                    color: 'white', fontSize: '10px', fontWeight: '800',
                    padding: '4px 32px', transform: 'rotate(35deg)',
                    letterSpacing: '0.05em',
                  }}>OFERTA</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: '10px', color: '#a78bfa', margin: '0 0 4px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Precio especial de lanzamiento</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '22px', fontWeight: '700', color: isLight ? '#999' : '#777', textDecoration: 'line-through', lineHeight: 1 }}>$29.99</span>
                        <span style={{ fontSize: '36px', fontWeight: '900', color: isLight ? '#6d28d9' : '#c4b5fd', lineHeight: 1 }}>$9.99</span>
                        <span style={{ fontSize: '12px', color: ts.textSecondary }}>USD</span>
                      </div>
                      <p style={{ fontSize: '11px', color: '#ef4444', fontWeight: '700', margin: '4px 0 0' }}>Ahorras $20 — 67% de descuento</p>
                      <p style={{ fontSize: '10px', color: '#facc15', fontWeight: '700', margin: '6px 0 0', letterSpacing: '0.05em' }}>⏳ Precio de lanzamiento — por tiempo limitado</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {['✓ Sin suscripción', '✓ Descarga inmediata', '✓ Tuyo para siempre'].map((t, i) => (
                        <p key={i} style={{ fontSize: '11px', color: '#a78bfa', margin: '0 0 3px', fontWeight: 600 }}>{t}</p>
                      ))}
                    </div>
                  </div>
                </div>

                {/* CTA */}
                <button onClick={handleVideoPurchase} disabled={videoPurchasing}
                  style={{
                    width: '100%', padding: '18px 24px',
                    background: videoPurchasing
                      ? 'rgba(124,58,237,0.4)'
                      : 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4f46e5 100%)',
                    color: 'white', fontWeight: '800', fontSize: '17px', letterSpacing: '-0.01em',
                    border: 'none', borderRadius: '16px',
                    cursor: videoPurchasing ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    boxShadow: videoPurchasing ? 'none' : '0 8px 32px rgba(109,40,217,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                    transition: 'all 0.3s', fontFamily: ts.font,
                  }}>
                  {videoPurchasing ? (
                    '⏳ Redirigiendo al pago...'
                  ) : (
                    <>
                      <span style={{ fontSize: '20px' }}>🎬</span>
                      <span>Quiero sorprenderlo con un video — <span style={{ textDecoration: 'line-through', opacity: 0.6, fontSize: '14px' }}>$29.99</span> $9.99</span>
                      <span style={{ marginLeft: 'auto', fontSize: '18px', opacity: 0.7 }}>→</span>
                    </>
                  )}
                </button>
                {videoError && (
                  <p style={{ color: '#f87171', fontSize: '13px', textAlign: 'center', marginTop: '10px' }}>{videoError}</p>
                )}
              </>
            )}

            {/* STATE: Paid, pending photos (status: pending) */}
            {videoOrder && videoOrder.status === 'pending' && (
              <>
                {/* Film strip decoration */}
                <div style={{ display: 'flex', gap: '3px', marginBottom: '18px', overflow: 'hidden', height: '6px', opacity: 0.35 }}>
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} style={{ flex: 1, borderRadius: '2px', background: i % 3 === 0 ? '#8b5cf6' : 'rgba(139,92,246,0.25)' }} />
                  ))}
                </div>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '20px' }}>
                  <div style={{
                    width: '54px', height: '54px', minWidth: '54px', borderRadius: '16px',
                    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '26px',
                    boxShadow: '0 8px 24px rgba(124,58,237,0.45)',
                    flexShrink: 0,
                  }}>📸</div>
                  <div>
                    <h3 style={{ fontSize: '19px', fontWeight: '900', marginBottom: '5px', color: ts.textPrimary, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                      ¡Sube tus fotos!
                    </h3>
                    <p style={{ fontSize: '13px', color: ts.textSecondary, lineHeight: '1.5', margin: 0 }}>
                      Selecciona de <span style={{ color: '#a78bfa', fontWeight: '700' }}>3 a 15 fotos</span> para tu video cinematográfico
                    </p>
                  </div>
                </div>

                {/* Photo grid */}
                {videoPhotos.length > 0 && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                    gap: '8px', marginBottom: '16px',
                  }}>
                    {videoPhotos.map((photo, i) => (
                      <div key={i} style={{
                        position: 'relative', aspectRatio: '1', borderRadius: '12px', overflow: 'hidden',
                        border: '2px solid rgba(139,92,246,0.3)',
                        boxShadow: '0 4px 12px rgba(124,58,237,0.2)',
                      }}>
                        <img src={photo.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button onClick={() => removeVideoPhoto(i)} style={{
                          position: 'absolute', top: '4px', right: '4px',
                          width: '22px', height: '22px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', border: 'none', color: 'white',
                          fontSize: '11px', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 2px 8px rgba(124,58,237,0.5)',
                        }}>✕</button>
                        <div style={{
                          position: 'absolute', bottom: '4px', left: '4px',
                          background: 'linear-gradient(135deg, rgba(124,58,237,0.85), rgba(79,70,229,0.85))',
                          borderRadius: '8px',
                          padding: '2px 7px', fontSize: '10px', color: 'white', fontWeight: '700',
                          backdropFilter: 'blur(4px)',
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

                {videoPhotos.length < 15 && (
                  <button onClick={() => videoPhotoInputRef.current?.click()}
                    style={{
                      width: '100%', padding: '16px',
                      background: isLight ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.08)',
                      color: isLight ? '#6d28d9' : '#c4b5fd', fontWeight: '700', fontSize: '15px',
                      border: '2px dashed rgba(139,92,246,0.3)', borderRadius: '14px',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      fontFamily: ts.font, marginBottom: '14px',
                      transition: 'all 0.3s',
                    }}>
                    📷 {videoPhotos.length > 0 ? 'Agregar más fotos' : 'Seleccionar fotos'}
                  </button>
                )}

                {/* Photo count strip */}
                <div style={{
                  background: isLight ? 'rgba(109,40,217,0.07)' : 'rgba(124,58,237,0.12)',
                  border: '1px solid rgba(139,92,246,0.2)',
                  borderRadius: '12px', padding: '12px 16px', marginBottom: '14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: videoPhotos.length >= 3 ? '#22c55e' : '#a78bfa',
                      boxShadow: videoPhotos.length >= 3 ? '0 0 8px rgba(34,197,94,0.5)' : 'none',
                    }} />
                    <span style={{
                      fontSize: '13px', fontWeight: '700',
                      color: videoPhotos.length >= 3 ? '#22c55e' : '#a78bfa',
                    }}>
                      {videoPhotos.length}/15 fotos
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: ts.textSecondary, fontWeight: 600 }}>
                    {videoPhotos.length < 3 ? `Faltan ${3 - videoPhotos.length} más` : '✓ Listo para generar'}
                  </span>
                </div>

                {/* Progress bar for count */}
                <div style={{
                  width: '100%', height: '4px', borderRadius: '2px',
                  background: isLight ? '#e2e8f0' : 'rgba(255,255,255,0.06)',
                  marginBottom: '16px', overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${Math.min(100, (videoPhotos.length / 3) * 100)}%`, height: '100%', borderRadius: '2px',
                    background: videoPhotos.length >= 3 ? 'linear-gradient(90deg, #22c55e, #16a34a)' : 'linear-gradient(90deg, #7c3aed, #a78bfa)',
                    transition: 'width 0.4s ease',
                  }} />
                </div>

                {/* Generate button */}
                <button
                  onClick={handleVideoGenerate}
                  disabled={videoPhotos.length < 3 || uploadingVideoPics}
                  style={{
                    width: '100%', padding: '18px 24px',
                    background: videoPhotos.length >= 3
                      ? (uploadingVideoPics ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4f46e5 100%)')
                      : isLight ? '#e2e8f0' : 'rgba(255,255,255,0.06)',
                    color: videoPhotos.length >= 3 ? 'white' : ts.textSecondary,
                    fontWeight: '800', fontSize: '17px', letterSpacing: '-0.01em',
                    border: 'none', borderRadius: '16px',
                    cursor: videoPhotos.length >= 3 && !uploadingVideoPics ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    transition: 'all 0.3s', fontFamily: ts.font,
                    boxShadow: videoPhotos.length >= 3 && !uploadingVideoPics
                      ? '0 8px 32px rgba(109,40,217,0.5), inset 0 1px 0 rgba(255,255,255,0.15)'
                      : 'none',
                  }}>
                  {uploadingVideoPics ? (
                    '⏳ Subiendo fotos...'
                  ) : (
                    <>
                      <span style={{ fontSize: '20px' }}>🎬</span>
                      <span>Generar Video</span>
                      {videoPhotos.length >= 3 && <span style={{ marginLeft: 'auto', fontSize: '18px', opacity: 0.7 }}>→</span>}
                    </>
                  )}
                </button>

                {videoError && (
                  <p style={{ color: '#f87171', fontSize: '13px', textAlign: 'center', marginTop: '10px' }}>{videoError}</p>
                )}
              </>
            )}

            {/* STATE: Photos uploaded, processing */}
            {videoOrder && (videoOrder.status === 'photos_uploaded' || videoOrder.status === 'processing') && (
              <>
                {/* Film strip decoration */}
                <div style={{ display: 'flex', gap: '3px', marginBottom: '18px', overflow: 'hidden', height: '6px', opacity: 0.35 }}>
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} style={{ flex: 1, borderRadius: '2px', background: i % 3 === 0 ? '#8b5cf6' : 'rgba(139,92,246,0.25)' }} />
                  ))}
                </div>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '22px' }}>
                  <div style={{
                    width: '54px', height: '54px', minWidth: '54px', borderRadius: '16px',
                    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '26px',
                    boxShadow: '0 8px 24px rgba(124,58,237,0.45)',
                    flexShrink: 0,
                    animation: 'pulse 2s ease-in-out infinite',
                  }}>🎬</div>
                  <div>
                    <h3 style={{ fontSize: '19px', fontWeight: '900', marginBottom: '5px', color: ts.textPrimary, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                      Generando tu video...
                    </h3>
                    <p style={{ fontSize: '13px', color: ts.textSecondary, lineHeight: '1.5', margin: 0 }}>
                      Creando tu recuerdo cinematográfico con efecto Ken Burns
                    </p>
                  </div>
                </div>

                {/* Steps progress */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                  {[
                    { icon: '✅', label: 'Fotos recibidas', done: true },
                    { icon: '🎞️', label: 'Aplicando efectos cinematográficos', done: false, active: true },
                    { icon: '🎵', label: 'Sincronizando con tu canción', done: false },
                    { icon: '💾', label: 'Renderizando video HD', done: false },
                  ].map((step, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 14px', borderRadius: '12px',
                      background: step.active ? (isLight ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.08)') : 'transparent',
                      border: step.active ? '1px solid rgba(139,92,246,0.15)' : '1px solid transparent',
                    }}>
                      <span style={{ fontSize: '16px', width: '22px', textAlign: 'center' }}>
                        {step.done ? '✅' : (step.active ? '⏳' : <span style={{ opacity: 0.3 }}>{step.icon}</span>)}
                      </span>
                      <span style={{
                        fontSize: '13px', fontWeight: step.active ? '700' : '600',
                        color: step.done ? '#22c55e' : (step.active ? '#a78bfa' : ts.textSecondary),
                      }}>{step.label}</span>
                      {step.active && (
                        <div style={{
                          marginLeft: 'auto', width: '16px', height: '16px',
                          border: '2px solid rgba(139,92,246,0.3)', borderTopColor: '#a78bfa',
                          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                        }} />
                      )}
                    </div>
                  ))}
                </div>

                {/* Progress bar */}
                <div style={{
                  width: '100%', height: '6px', borderRadius: '3px',
                  background: isLight ? '#e2e8f0' : 'rgba(255,255,255,0.06)',
                  overflow: 'hidden', marginBottom: '14px',
                }}>
                  <div style={{
                    width: '60%', height: '100%', borderRadius: '3px',
                    background: 'linear-gradient(90deg, #7c3aed, #a78bfa, #7c3aed)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmerAccent 2s linear infinite',
                  }} />
                </div>

                {/* Info strip */}
                <div style={{
                  background: isLight ? 'rgba(109,40,217,0.07)' : 'rgba(124,58,237,0.12)',
                  border: '1px solid rgba(139,92,246,0.2)',
                  borderRadius: '12px', padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: '10px',
                }}>
                  <span style={{ fontSize: '16px' }}>📧</span>
                  <p style={{ fontSize: '12px', color: '#a78bfa', margin: 0, fontWeight: 600, lineHeight: 1.4 }}>
                    Te notificaremos por email cuando esté listo — esto puede tomar unos minutos
                  </p>
                </div>
              </>
            )}

            {/* STATE: Completed — Show video player + download */}
            {videoOrder && videoOrder.status === 'completed' && videoOrder.video_url && (
              <>
                {/* Film strip decoration */}
                <div style={{ display: 'flex', gap: '3px', marginBottom: '18px', overflow: 'hidden', height: '6px', opacity: 0.35 }}>
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} style={{ flex: 1, borderRadius: '2px', background: i % 3 === 0 ? '#8b5cf6' : 'rgba(139,92,246,0.25)' }} />
                  ))}
                </div>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '18px' }}>
                  <div style={{
                    width: '54px', height: '54px', minWidth: '54px', borderRadius: '16px',
                    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '26px',
                    boxShadow: '0 8px 24px rgba(124,58,237,0.45)',
                    flexShrink: 0,
                  }}>🎉</div>
                  <div>
                    <h3 style={{ fontSize: '19px', fontWeight: '900', marginBottom: '5px', color: ts.textPrimary, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                      ¡Tu video está listo!
                    </h3>
                    <p style={{ fontSize: '13px', color: ts.textSecondary, lineHeight: '1.5', margin: 0 }}>
                      Tu recuerdo cinematográfico quedó increíble
                    </p>
                  </div>
                </div>

                {/* Video player */}
                <div style={{
                  borderRadius: '16px', overflow: 'hidden', marginBottom: '16px',
                  border: '2px solid rgba(139,92,246,0.25)',
                  boxShadow: '0 12px 40px rgba(109,40,217,0.3)',
                }}>
                  <video
                    src={videoOrder.video_url}
                    controls
                    style={{ width: '100%', display: 'block' }}
                    poster=""
                  />
                </div>

                {/* Feature chips */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {['🎞️ HD', '🎵 Con tu canción', '📸 Tus fotos', '✨ Efecto Ken Burns'].map((chip, i) => (
                    <span key={i} style={{
                      padding: '5px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600',
                      background: isLight ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.08)',
                      border: '1px solid rgba(139,92,246,0.15)',
                      color: '#a78bfa',
                    }}>{chip}</span>
                  ))}
                </div>

                {/* Download CTA */}
                <button onClick={handleVideoDownload}
                  style={{
                    width: '100%', padding: '18px 24px',
                    background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4f46e5 100%)',
                    color: 'white', fontWeight: '800', fontSize: '17px', letterSpacing: '-0.01em',
                    border: 'none', borderRadius: '16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    boxShadow: '0 8px 32px rgba(109,40,217,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                    transition: 'all 0.3s', fontFamily: ts.font,
                  }}>
                  <span style={{ fontSize: '20px' }}>⬇️</span>
                  <span>Descargar Video MP4</span>
                  <span style={{ marginLeft: 'auto', fontSize: '18px', opacity: 0.7 }}>→</span>
                </button>

                {/* Share hint */}
                <p style={{ textAlign: 'center', fontSize: '12px', color: ts.textSecondary, marginTop: '12px', fontWeight: 600 }}>
                  💡 Compártelo por WhatsApp para sorprender a {recipientName}
                </p>
              </>
            )}

            {/* STATE: Failed */}
            {videoOrder && videoOrder.status === 'failed' && (
              <>
                {/* Film strip decoration */}
                <div style={{ display: 'flex', gap: '3px', marginBottom: '18px', overflow: 'hidden', height: '6px', opacity: 0.35 }}>
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} style={{ flex: 1, borderRadius: '2px', background: i % 3 === 0 ? '#8b5cf6' : 'rgba(139,92,246,0.25)' }} />
                  ))}
                </div>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '18px' }}>
                  <div style={{
                    width: '54px', height: '54px', minWidth: '54px', borderRadius: '16px',
                    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '26px',
                    boxShadow: '0 8px 24px rgba(124,58,237,0.45)',
                    flexShrink: 0,
                  }}>⚠️</div>
                  <div>
                    <h3 style={{ fontSize: '19px', fontWeight: '900', marginBottom: '5px', color: ts.textPrimary, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                      Error al generar el video
                    </h3>
                    <p style={{ fontSize: '13px', color: ts.textSecondary, lineHeight: '1.5', margin: 0 }}>
                      Algo salió mal, pero no te preocupes — te ayudamos
                    </p>
                  </div>
                </div>

                {/* Error detail card */}
                <div style={{
                  background: isLight ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '12px', padding: '14px 16px', marginBottom: '16px',
                  display: 'flex', alignItems: 'center', gap: '10px',
                }}>
                  <span style={{ fontSize: '16px' }}>❌</span>
                  <p style={{ fontSize: '13px', color: '#f87171', margin: 0, fontWeight: 600, lineHeight: 1.4 }}>
                    {videoOrder.error_message || 'Ocurrió un error inesperado durante la generación del video.'}
                  </p>
                </div>

                {/* Help options */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                  <div style={{
                    padding: '14px 12px', borderRadius: '12px',
                    background: isLight ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.08)',
                    border: '1px solid rgba(139,92,246,0.15)',
                    textAlign: 'center',
                  }}>
                    <span style={{ fontSize: '20px', display: 'block', marginBottom: '6px' }}>🔄</span>
                    <p style={{ fontSize: '11px', fontWeight: '700', color: isLight ? '#4c1d95' : '#c4b5fd', margin: '0 0 2px' }}>Reintentar</p>
                    <p style={{ fontSize: '10px', color: ts.textSecondary, margin: 0 }}>Sin costo extra</p>
                  </div>
                  <div style={{
                    padding: '14px 12px', borderRadius: '12px',
                    background: isLight ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.08)',
                    border: '1px solid rgba(139,92,246,0.15)',
                    textAlign: 'center',
                  }}>
                    <span style={{ fontSize: '20px', display: 'block', marginBottom: '6px' }}>💰</span>
                    <p style={{ fontSize: '11px', fontWeight: '700', color: isLight ? '#4c1d95' : '#c4b5fd', margin: '0 0 2px' }}>Reembolso</p>
                    <p style={{ fontSize: '10px', color: ts.textSecondary, margin: 0 }}>100% garantizado</p>
                  </div>
                </div>

                {/* Contact CTA */}
                <a href="mailto:soporte@regalosquecantan.com" style={{ textDecoration: 'none', display: 'block' }}>
                  <button style={{
                    width: '100%', padding: '18px 24px',
                    background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4f46e5 100%)',
                    color: 'white', fontWeight: '800', fontSize: '17px', letterSpacing: '-0.01em',
                    border: 'none', borderRadius: '16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    boxShadow: '0 8px 32px rgba(109,40,217,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                    transition: 'all 0.3s', fontFamily: ts.font,
                  }}>
                    <span style={{ fontSize: '20px' }}>📧</span>
                    <span>Contactar soporte</span>
                    <span style={{ marginLeft: 'auto', fontSize: '18px', opacity: 0.7 }}>→</span>
                  </button>
                </a>
              </>
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
                <img
                  src={currentSong.image_url || getGenreImage(currentSong?.genre)}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => {
                    const fallback = getGenreImage(currentSong?.genre);
                    if (e.target.src !== window.location.origin + fallback) {
                      e.target.src = fallback;
                    } else {
                      e.target.parentElement.innerHTML = '<span style="font-size:32px;display:flex;align-items:center;justify-content:center;height:100%">🎵</span>';
                    }
                  }}
                />
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

          {/* ===== CREATE ANOTHER SONG CTA ===== */}
          <div style={{
            background: ts.cardBg, borderRadius: '24px', padding: '24px',
            border: `1px solid ${ts.cardBorder}`, marginBottom: '24px',
            backdropFilter: ts.cardBlur,
            animation: 'fadeInUp 0.7s ease-out 0.75s both',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: '28px', marginBottom: '10px' }}>🎁</p>
            <h3 style={{ fontSize: '17px', fontWeight: '800', marginBottom: '6px', color: ts.textPrimary }}>
              ¿Quieres sorprender a alguien más?
            </h3>
            <p style={{ fontSize: '13px', color: ts.textSecondary, marginBottom: '18px', lineHeight: '1.5' }}>
              Crea otra canción personalizada para otra persona especial en tu vida.
            </p>
            <a href="/" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '16px 32px',
              background: ts.accentGrad,
              color: ts.btnText, fontWeight: '800', fontSize: '16px',
              border: 'none', borderRadius: '14px', textDecoration: 'none',
              boxShadow: `0 6px 25px rgba(${ts.accentRgb},0.3)`,
              transition: 'all 0.3s', fontFamily: ts.font,
            }}>
              🎤 Crear Otra Canción
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
