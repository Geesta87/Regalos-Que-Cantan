import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import { createCheckout, validateCoupon, supabase, checkSongStatus } from '../services/api';
import genres from '../config/genres';
import { trackStep } from '../services/tracking';

// Preview settings
const PREVIEW_START = 15;
const PREVIEW_DURATION = 20;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

// ✅ NEW: Version personality - VIBRANT colors
const VERSION_VIBES = [
  { label: 'Emotiva', emoji: '💫', color: '#4f9cf7', gradient: 'linear-gradient(135deg, #2563eb, #3b82f6)', bgTint: 'rgba(59,130,246,0.12)' },
  { label: 'Enérgica', emoji: '🔥', color: '#a855f7', gradient: 'linear-gradient(135deg, #7c3aed, #9333ea)', bgTint: 'rgba(168,85,247,0.12)' }
];

export default function ComparisonPage() {
  const context = useContext(AppContext);
  
  const { 
    formData = {}, 
    songData = {}, 
    setSongData = () => {}, 
    navigateTo = () => {} 
  } = context || {};
  
  // Songs state
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Audio state
  const [playingId, setPlayingId] = useState(null);
  const [currentTimes, setCurrentTimes] = useState({});
  const [previewEnded, setPreviewEnded] = useState({});
  
  // ✅ NEW: Auto-play state (full sequential preview)
  const [autoPlayed, setAutoPlayed] = useState(false);
  const [autoPlayingIndex, setAutoPlayingIndex] = useState(-1); // -1 = not auto-playing, 0 = song 1, 1 = song 2
  
  // ✅ NEW: Song 2 background generation state
  const [song2Loading, setSong2Loading] = useState(false);
  const [song2Ready, setSong2Ready] = useState(false);
  const song2PollRef = useRef(null);
  const song2Started = useRef(false);
  
  // ✅ NEW: Entrance animation state
  const [isVisible, setIsVisible] = useState(false);
  
  // ✅ NEW: Lyrics expand state
  const [expandedLyrics, setExpandedLyrics] = useState({});
  
  // Selection state — ✅ REC 1: Pre-select V1 (set after songs load)
  const [selectedSongId, setSelectedSongId] = useState(null);
  const [purchaseBoth, setPurchaseBoth] = useState(false);
  const [showCouponInput, setShowCouponInput] = useState(false); // ✅ REC 3: Hide coupon behind toggle
  const [selectionPop, setSelectionPop] = useState(null); // ✅ REC 10: Micro-interaction
  
  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [isLoadingCoupon, setIsLoadingCoupon] = useState(false);
  
  // ✅ REC 8: Dynamic session urgency timer (works year-round)
  const [sessionCountdown, setSessionCountdown] = useState({ mins: 29, secs: 59 });
  const sessionEndRef = useRef(Date.now() + 30 * 60 * 1000); // 30 min session
  const videoTestimonialRefs = useRef({});
  const [playingTestimonial, setPlayingTestimonial] = useState(null);

  useEffect(() => {
    const tick = () => {
      const diff = sessionEndRef.current - Date.now();
      if (diff <= 0) {
        setSessionCountdown({ mins: 0, secs: 0 });
        return;
      }
      setSessionCountdown({
        mins: Math.floor(diff / 60000),
        secs: Math.floor((diff % 60000) / 1000)
      });
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTestimonialToggle = (id) => {
    const video = videoTestimonialRefs.current[id];
    if (!video) return;
    if (playingTestimonial === id) {
      video.pause();
      setPlayingTestimonial(null);
    } else {
      if (playingTestimonial && videoTestimonialRefs.current[playingTestimonial]) {
        videoTestimonialRefs.current[playingTestimonial].pause();
      }
      video.play().then(() => setPlayingTestimonial(id)).catch(() => {
        video.muted = true;
        video.play().then(() => setPlayingTestimonial(id)).catch(() => {});
      });
    }
  };

  // WhatsApp phone state
  const [whatsappPhone, setWhatsappPhone] = useState('');
  
  // Checkout state
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  
  const audioRefs = useRef({});

  // Safely get genre display name
  const genreConfig = genres?.[formData?.genre];
  const genreName = genreConfig?.name || formData?.genre || 'Género';

  // Pricing
  const singlePrice = 29.99;
  const bundlePrice = 39.99;
  const bundleSavings = (singlePrice * 2) - bundlePrice;
  const isFree = couponApplied?.free || false;

  // ✅ REC 1: Auto-select Version 1 when songs load (reduce decision friction)
  useEffect(() => {
    if (songs.length > 0 && !selectedSongId && !purchaseBoth) {
      setSelectedSongId(songs[0].id);
    }
  }, [songs]);

  // ✅ REC 10: Selection micro-interaction helper
  const triggerSelectionPop = (id) => {
    setSelectionPop(id);
    setTimeout(() => setSelectionPop(null), 600);
  };

  // Check if something is selected
  const hasSelection = selectedSongId || purchaseBoth;

  // Track page view
  useEffect(() => {
    trackStep('comparison');
  }, []);

  // ✅ NEW: Entrance animation trigger
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // ✅ FIX: Helper function to fetch songs from database by IDs
  const fetchSongsFromIds = async (songIds) => {
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .in('id', songIds);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        const loadedSongs = data.map((song, index) => ({
          id: song.id,
          version: song.version || index + 1,
          audioUrl: song.audio_url,
          previewUrl: song.preview_url || song.audio_url,
          imageUrl: song.image_url,
          lyrics: song.lyrics
        }));
        setSongs(loadedSongs.sort((a, b) => (a.version || 1) - (b.version || 1)));
        setLoading(false);
      } else {
        setError('No se encontraron las canciones');
        setLoading(false);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Error fetching songs from URL params:', err);
      }
      setError('Error al cargar las canciones');
      setLoading(false);
    }
  };

  // Load songs from songData OR URL parameters (for page refresh support)
  useEffect(() => {
    try {
      const loadedSongs = [];
      
      if (songData?.songs && Array.isArray(songData.songs) && songData.songs.length > 0) {
        loadedSongs.push(...songData.songs);
      } 
      else if (songData?.song1) {
        loadedSongs.push({ ...songData.song1, version: 1 });
        if (songData?.song2) {
          loadedSongs.push({ ...songData.song2, version: 2 });
        }
      }
      else if (songData?.id) {
        loadedSongs.push({
          id: songData.id,
          version: 1,
          audioUrl: songData.audioUrl,
          previewUrl: songData.previewUrl,
          imageUrl: songData.imageUrl,
          lyrics: songData.lyrics
        });
      }
      
      if (loadedSongs.length > 0) {
        setSongs(loadedSongs.sort((a, b) => (a.version || 1) - (b.version || 1)));
        setLoading(false);
        
        const songIds = loadedSongs.map(s => s.id);
        localStorage.setItem('rqc_comparison_songs', JSON.stringify(songIds));
        
        return;
      }
      
      const params = new URLSearchParams(window.location.search);
      const songIdsParam = params.get('song_ids');
      const singleSongId = params.get('song_id');
      
      if (songIdsParam) {
        const songIds = songIdsParam.split(',').filter(id => id.trim());
        if (songIds.length > 0) {
          fetchSongsFromIds(songIds);
          return;
        }
      } else if (singleSongId) {
        fetchSongsFromIds([singleSongId]);
        return;
      }
      
      const savedSongIds = localStorage.getItem('rqc_comparison_songs');
      if (savedSongIds) {
        try {
          const songIds = JSON.parse(savedSongIds);
          if (Array.isArray(songIds) && songIds.length > 0) {
            if (import.meta.env.DEV) {
              console.log('Recovering songs from localStorage:', songIds);
            }
            
            const savedSelection = localStorage.getItem('rqc_checkout_selection');
            if (savedSelection) {
              try {
                const selection = JSON.parse(savedSelection);
                if (selection.selectedSongId) setSelectedSongId(selection.selectedSongId);
                if (selection.purchaseBoth) setPurchaseBoth(selection.purchaseBoth);
                if (selection.couponCode) setCouponCode(selection.couponCode);
              } catch (e) {}
            }
            
            fetchSongsFromIds(songIds);
            return;
          }
        } catch (e) {
          if (import.meta.env.DEV) {
            console.warn('Failed to parse saved song IDs:', e);
          }
        }
      }
      
      setError('No songs available');
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [songData]);

  // ✅ NEW: Background Song 2 polling (Song 2 already generating, we just poll for completion)
  useEffect(() => {
    const pendingId = songData?.song2PendingId;
    if (!pendingId || song2Started.current || loading) return;
    if (songs.length === 0) return;
    song2Started.current = true;
    setSong2Loading(true);

    if (import.meta.env.DEV) console.log('🎵 Polling for Song 2 (already generating):', pendingId);

    const pollForSong2 = async () => {
      try {
        const status = await checkSongStatus(pendingId);
        if (import.meta.env.DEV) console.log('📊 Song 2 poll:', status.status);

        if (status.status === 'completed' && status.song) {
          clearInterval(song2PollRef.current);
          const newSong = {
            id: status.song.id,
            version: 2,
            audioUrl: status.song.audio_url,
            previewUrl: status.song.preview_url || status.song.audio_url,
            imageUrl: status.song.image_url,
            lyrics: status.song.lyrics
          };
          setSongs(prev => {
            const updated = [...prev, newSong].sort((a, b) => (a.version || 1) - (b.version || 1));
            localStorage.setItem('rqc_comparison_songs', JSON.stringify(updated.map(s => s.id)));
            return updated;
          });
          setSong2Loading(false);
          setSong2Ready(true);
          if (import.meta.env.DEV) console.log('🎉 Song 2 ready!');
        } else if (status.status === 'failed') {
          clearInterval(song2PollRef.current);
          setSong2Loading(false);
          if (import.meta.env.DEV) console.warn('⚠️ Song 2 generation failed');
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('Song 2 poll error:', err);
      }
    };

    // Start polling immediately, then every 3 seconds
    pollForSong2();
    song2PollRef.current = setInterval(pollForSong2, 3000);

    return () => {
      if (song2PollRef.current) clearInterval(song2PollRef.current);
    };
  }, [songData, songs.length, loading]);

  // ✅ NEW: Auto-play full sequential preview (Song 1 → Song 2)
  useEffect(() => {
    if (autoPlayed || songs.length === 0 || loading) return;
    
    const firstSong = songs[0];
    const audio = audioRefs.current[firstSong?.id];
    if (!audio) return;

    const startTimer = setTimeout(() => {
      try {
        audio.currentTime = PREVIEW_START;
        audio.volume = 0.7;
        const playPromise = audio.play();
        
        if (playPromise !== undefined) {
          playPromise.then(() => {
            setPlayingId(firstSong.id);
            setAutoPlayingIndex(0);
          }).catch(() => {
            // Autoplay blocked by browser — that's fine
            setAutoPlayed(true);
          });
        }
      } catch (e) {
        setAutoPlayed(true);
      }
    }, 1500);

    return () => clearTimeout(startTimer);
  }, [songs, loading, autoPlayed]);

  const handlePlay = (songId) => {
    try {
      // If auto-playing, cancel it on manual interaction
      if (autoPlayingIndex >= 0) {
        setAutoPlayingIndex(-1);
        setAutoPlayed(true);
      }

      const audio = audioRefs.current[songId];
      if (!audio) return;

      if (playingId === songId) {
        audio.pause();
        setPlayingId(null);
      } else {
        Object.values(audioRefs.current).forEach(a => { 
          if (a) { a.pause(); a.volume = 1.0; } 
        });
        
        if (previewEnded[songId] || audio.currentTime < PREVIEW_START || audio.currentTime >= PREVIEW_END) {
          audio.currentTime = PREVIEW_START;
          setPreviewEnded(prev => ({ ...prev, [songId]: false }));
          setCurrentTimes(prev => ({ ...prev, [songId]: 0 }));
        }
        
        audio.volume = 1.0;
        audio.play().catch(err => {
          if (import.meta.env.DEV) console.error('Play error:', err);
        });
        setPlayingId(songId);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Play toggle error:', err);
    }
  };

  const handleTimeUpdate = (songId, audio) => {
    if (!audio) return;
    try {
      const time = audio.currentTime;
      const previewTime = Math.max(0, time - PREVIEW_START);
      
      setCurrentTimes(prev => ({
        ...prev,
        [songId]: Math.min(previewTime, PREVIEW_DURATION)
      }));

      if (time >= PREVIEW_END) {
        audio.pause();
        audio.currentTime = PREVIEW_START;
        setPlayingId(null);
        setPreviewEnded(prev => ({ ...prev, [songId]: true }));
        
        // ✅ Auto-play chain: Song 1 ended → start Song 2
        if (autoPlayingIndex === 0 && songs.length >= 2) {
          const nextSong = songs[1];
          const nextAudio = audioRefs.current[nextSong?.id];
          if (nextAudio) {
            setTimeout(() => {
              try {
                nextAudio.currentTime = PREVIEW_START;
                nextAudio.volume = 0.7;
                nextAudio.play().then(() => {
                  setPlayingId(nextSong.id);
                  setAutoPlayingIndex(1);
                  setCurrentTimes(prev => ({ ...prev, [nextSong.id]: 0 }));
                  setPreviewEnded(prev => ({ ...prev, [nextSong.id]: false }));
                }).catch(() => {
                  setAutoPlayingIndex(-1);
                  setAutoPlayed(true);
                });
              } catch (e) {
                setAutoPlayingIndex(-1);
                setAutoPlayed(true);
              }
            }, 800); // Brief pause between songs
          }
        }
        // Song 2 auto-play ended → done
        else if (autoPlayingIndex === 1) {
          setAutoPlayingIndex(-1);
          setAutoPlayed(true);
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Time update error:', err);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ✅ NEW: Extract lyrics preview (first meaningful lines)
  const getLyricsPreview = (lyrics) => {
    if (!lyrics) return [];
    return lyrics
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('['))
      .slice(0, 4);
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setIsLoadingCoupon(true);
    setCouponError('');
    
    try {
      const result = await validateCoupon(couponCode);
      setCouponApplied(result);
    } catch (err) {
      setCouponError('Código inválido o expirado');
      setCouponApplied(null);
    } finally {
      setIsLoadingCoupon(false);
    }
  };

  const handleCheckout = async () => {
    if (!selectedSongId && !purchaseBoth) {
      alert('Selecciona una canción o elige ambas');
      return;
    }

    setIsCheckingOut(true);
    try {
      const songIdsToCheckout = purchaseBoth 
        ? songs.map(s => s.id)
        : [selectedSongId];
      
      // ✅ FIX: Verify songs have actual customer data before checkout
      // This prevents paying for ghost/empty records
      for (const songId of songIdsToCheckout) {
        const { data: dbSong, error: verifyError } = await supabase
          .from('songs')
          .select('recipient_name, email')
          .eq('id', songId)
          .single();
        
        if (verifyError || !dbSong?.recipient_name || !dbSong?.email) {
          console.error('❌ Song missing data, blocking checkout:', songId, dbSong);
          alert('Error: Esta canción no tiene datos completos. Por favor genera una nueva canción desde el inicio.');
          setIsCheckingOut(false);
          return;
        }
      }

      const codeToSend = couponApplied?.code || couponCode.trim().toUpperCase() || null;

      const allSongIds = songs.map(s => s.id);
      localStorage.setItem('rqc_comparison_songs', JSON.stringify(allSongIds));
      localStorage.setItem('rqc_checkout_selection', JSON.stringify({
        selectedSongId,
        purchaseBoth,
        couponCode: codeToSend
      }));

      // Save WhatsApp phone if provided
      const cleanPhone = whatsappPhone.replace(/\D/g, '');
      if (cleanPhone) {
        localStorage.setItem('rqc_whatsapp_phone', cleanPhone);
        try {
          for (const songId of songIdsToCheckout) {
            await supabase
              .from('songs')
              .update({ whatsapp_phone: cleanPhone })
              .eq('id', songId);
          }
        } catch (phoneErr) {
          if (import.meta.env.DEV) console.warn('Could not save WhatsApp phone:', phoneErr);
        }
      }

      if (import.meta.env.DEV) {
        console.log('Checkout - songIds:', songIdsToCheckout);
        console.log('Checkout - coupon:', codeToSend);
        console.log('Checkout - whatsapp:', cleanPhone || 'not provided');
      }

      const result = await createCheckout(songIdsToCheckout, formData?.email, codeToSend, purchaseBoth);
      
      if (result.url) {
        window.location.href = result.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Checkout error:', err);
      alert('Error al procesar el pago. Intenta de nuevo.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const selectSong = (songId) => {
    setSelectedSongId(songId);
    setPurchaseBoth(false);
    triggerSelectionPop(songId); // ✅ REC 10
  };

  const selectBoth = () => {
    setPurchaseBoth(true);
    setSelectedSongId(null);
    triggerSelectionPop('bundle'); // ✅ REC 10
  };

  const getSelectionLabel = () => {
    if (purchaseBoth) return '2 Canciones (Ambas versiones)';
    if (selectedSongId) {
      const song = songs.find(s => s.id === selectedSongId);
      return `1 Canción (Versión ${song?.version || 1})`;
    }
    return null;
  };

  // ==================== RENDER ====================

  if (loading) {
    return (
      <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }`}</style>
        <div style={{textAlign: 'center'}}>
          <div style={{fontSize: '48px', marginBottom: '20px', animation: 'pulse 1.5s ease-in-out infinite'}}>🎵</div>
          <p style={{fontSize: '20px'}}>Cargando tus canciones...</p>
        </div>
      </div>
    );
  }

  if (error || !songs || songs.length === 0) {
    return (
      <div style={{backgroundColor: '#1a3a2f', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{textAlign: 'center'}}>
          <p style={{fontSize: '24px'}}>❌ {error || 'No se encontraron canciones'}</p>
          <button onClick={() => navigateTo('details')} style={{padding: '12px 24px', background: '#e11d74', color: 'white', border: 'none', borderRadius: '8px', marginTop: '20px', cursor: 'pointer'}}>
            Volver a intentar
          </button>
        </div>
      </div>
    );
  }

  const recipientName = formData?.recipientName || 'ti';
  
  return (
    <div style={{background: 'linear-gradient(160deg, #0f2027 0%, #1a3a2f 40%, #1e3a24 70%, #162832 100%)', color: 'white', minHeight: '100vh', padding: '20px', overflow: 'hidden'}}>
      
      {/* ✅ CSS Animations */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 25px rgba(212,175,55,0.4), 0 0 50px rgba(212,175,55,0.15); }
          50% { box-shadow: 0 0 40px rgba(212,175,55,0.6), 0 0 80px rgba(212,175,55,0.25); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes eq1 { 0%, 100% { height: 8px; } 50% { height: 22px; } }
        @keyframes eq2 { 0%, 100% { height: 16px; } 50% { height: 8px; } }
        @keyframes eq3 { 0%, 100% { height: 12px; } 50% { height: 24px; } }
        @keyframes ribbonFloat {
          0%, 100% { transform: translateX(-50%) rotate(-1deg); }
          50% { transform: translateX(-50%) rotate(1deg); }
        }
        @keyframes song2Reveal {
          0% { opacity: 0; transform: scale(0.9) translateY(15px); }
          50% { opacity: 1; transform: scale(1.03) translateY(-3px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes toastIn {
          0% { opacity: 0; transform: translate(-50%, 20px); }
          15% { opacity: 1; transform: translate(-50%, 0); }
          85% { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, -10px); }
        }
        @keyframes urgencyPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes selectionPop {
          0% { transform: scale(1); }
          40% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }
        @keyframes heartBurst {
          0% { opacity: 1; transform: scale(0.5) translateY(0); }
          100% { opacity: 0; transform: scale(1.5) translateY(-40px); }
        }
        @keyframes btnPulse {
          0%, 100% { box-shadow: 0 4px 18px var(--pulse-color, rgba(59,130,246,0.4)); }
          50% { box-shadow: 0 6px 28px var(--pulse-color, rgba(59,130,246,0.6)); }
        }
        @keyframes stickySlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes testimonialSlide {
          0%, 30% { opacity: 1; transform: translateX(0); }
          33%, 63% { opacity: 1; transform: translateX(-100%); }
          66%, 96% { opacity: 1; transform: translateX(-200%); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Audio elements */}
      {songs.map(song => (
        <audio
          key={song.id}
          ref={el => audioRefs.current[song.id] = el}
          src={song.audioUrl || song.previewUrl}
          preload="metadata"
          onLoadedMetadata={(e) => { if (e.target) e.target.currentTime = PREVIEW_START; }}
          onTimeUpdate={(e) => handleTimeUpdate(song.id, e.target)}
          onEnded={() => setPlayingId(null)}
        />
      ))}

      <div style={{
        maxWidth: '900px', 
        margin: '0 auto', 
        paddingTop: '30px',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>

        {/* ===== REC 8: Dynamic session urgency banner (works year-round) ===== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(225,29,116,0.15), rgba(168,85,247,0.1))',
          border: '1px solid rgba(225,29,116,0.3)',
          borderRadius: '12px',
          padding: '10px 18px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px'
        }}>
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>🔥 Tu precio especial expira en</span>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{
              background: 'rgba(225,29,116,0.3)',
              padding: '3px 8px',
              borderRadius: '6px',
              fontWeight: 'bold',
              fontSize: '15px',
              fontFamily: 'monospace',
              color: '#ff6b9d',
              minWidth: '32px',
              textAlign: 'center'
            }}>
              {String(sessionCountdown.mins).padStart(2, '0')}
            </span>
            <span style={{ color: '#ff6b9d', fontWeight: 'bold', animation: 'urgencyPulse 1s ease infinite' }}>:</span>
            <span style={{
              background: 'rgba(225,29,116,0.3)',
              padding: '3px 8px',
              borderRadius: '6px',
              fontWeight: 'bold',
              fontSize: '15px',
              fontFamily: 'monospace',
              color: '#ff6b9d',
              minWidth: '32px',
              textAlign: 'center'
            }}>
              {String(sessionCountdown.secs).padStart(2, '0')}
            </span>
          </div>
        </div>
        
        {/* ===== Simplified emotional header ===== */}
        <div style={{textAlign: 'center', marginBottom: '20px'}}>
          <p style={{
            fontSize: '12px',
            color: 'rgba(255,255,255,0.5)',
            margin: '0 0 4px 0',
            letterSpacing: '2px',
            textTransform: 'uppercase'
          }}>
            Hecho con ❤️ para
          </p>
          <h2 style={{
            fontSize: '28px',
            fontWeight: 'bold',
            margin: '0 0 6px 0',
            background: 'linear-gradient(90deg, #d4af37, #f5d77a, #d4af37)',
            backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            animation: 'shimmer 3s linear infinite'
          }}>
            {recipientName}
          </h2>
          <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '14px', margin: '0 0 14px 0'}}>
            Escucha y elige tu versión favorita
          </p>

          {/* ===== REC 6: Bundle toggle — top-level pricing selector ===== */}
          {songs.length >= 2 && (
            <div style={{
              display: 'inline-flex',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: '14px',
              padding: '4px',
              border: '1px solid rgba(255,255,255,0.12)',
              gap: '4px'
            }}>
              <button
                onClick={(e) => { e.stopPropagation(); if (purchaseBoth) { setSelectedSongId(songs[0]?.id); setPurchaseBoth(false); } }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '11px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  transition: 'all 0.3s',
                  background: !purchaseBoth ? 'linear-gradient(135deg, #2563eb, #3b82f6)' : 'transparent',
                  color: !purchaseBoth ? 'white' : 'rgba(255,255,255,0.5)',
                  boxShadow: !purchaseBoth ? '0 2px 12px rgba(37,99,235,0.4)' : 'none'
                }}
              >
                1 Canción — ${singlePrice}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); selectBoth(); }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '11px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  transition: 'all 0.3s',
                  background: purchaseBoth ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'transparent',
                  color: purchaseBoth ? 'white' : 'rgba(255,255,255,0.5)',
                  boxShadow: purchaseBoth ? '0 2px 12px rgba(34,197,94,0.4)' : 'none',
                  position: 'relative'
                }}
              >
                2 Canciones — ${bundlePrice}
                <span style={{
                  position: 'absolute',
                  top: '-8px',
                  right: '-8px',
                  background: '#ef4444',
                  color: 'white',
                  fontSize: '9px',
                  fontWeight: 'bold',
                  padding: '2px 6px',
                  borderRadius: '8px',
                  whiteSpace: 'nowrap'
                }}>
                  MEJOR VALOR
                </span>
              </button>
            </div>
          )}
          
          {/* Auto-play indicator */}
          {autoPlayingIndex >= 0 && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: `rgba(${autoPlayingIndex === 0 ? '59,130,246' : '139,92,246'},0.15)`,
              padding: '8px 18px',
              borderRadius: '20px',
              fontSize: '13px',
              color: autoPlayingIndex === 0 ? '#60a5fa' : '#a78bfa',
              marginTop: '12px',
              animation: 'fadeInUp 0.5s ease-out'
            }}>
              <div style={{display: 'flex', alignItems: 'flex-end', gap: '2px', height: '16px'}}>
                <div style={{width: '3px', background: 'currentColor', borderRadius: '2px', animation: 'eq1 0.6s ease-in-out infinite'}} />
                <div style={{width: '3px', background: 'currentColor', borderRadius: '2px', animation: 'eq2 0.5s ease-in-out infinite'}} />
                <div style={{width: '3px', background: 'currentColor', borderRadius: '2px', animation: 'eq3 0.7s ease-in-out infinite'}} />
              </div>
              {autoPlayingIndex === 0 ? '💫 Escuchando Versión 1 — Emotiva...' : '🔥 Escuchando Versión 2 — Enérgica...'}
            </div>
          )}
        </div>

        {/* ===== Social proof strip (compact) ===== */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '14px',
          marginBottom: '20px',
          flexWrap: 'wrap',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.2s both' : 'none'
        }}>
          {[
            { icon: '🔥', text: '147 canciones', sub: 'creadas hoy' },
            { icon: '⭐', text: '4.9/5', sub: 'satisfacción' }
          ].map((item, i) => (
            <span key={i} style={{
              fontSize: '12px',
              color: 'rgba(255,255,255,0.55)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              {item.icon} <span style={{color: '#f5d77a', fontWeight: '600'}}>{item.text}</span> {item.sub}
            </span>
          ))}
        </div>

        {/* ===== Song Cards (REC 4,5: Compact + Más Popular) ===== */}
        <div style={{
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', 
          gap: '16px', 
          marginBottom: '20px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.3s both' : 'none'
        }}>
          {songs.map((song, index) => {
            const isSelected = selectedSongId === song.id;
            const isOtherSelected = (selectedSongId && !isSelected) || purchaseBoth;
            const isPlaying = playingId === song.id;
            const isAutoHighlight = autoPlayingIndex === index;
            const vibe = VERSION_VIBES[index] || VERSION_VIBES[0];
            const lyricsPreview = getLyricsPreview(song.lyrics);
            const isExpanded = expandedLyrics[song.id];
            const isPop = selectionPop === song.id;
            
            return (
              <div
                key={song.id}
                onClick={() => selectSong(song.id)}
                style={{
                  background: (isSelected || isAutoHighlight)
                    ? `linear-gradient(135deg, ${vibe.color}30, ${vibe.color}15)` 
                    : 'linear-gradient(145deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))',
                  border: isSelected
                    ? `3px solid #f5d77a` 
                    : isAutoHighlight 
                      ? `3px solid ${vibe.color}`
                      : `2px solid ${vibe.color}30`,
                  borderRadius: '18px',
                  padding: '18px',
                  cursor: 'pointer',
                  transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                  opacity: (isOtherSelected && !purchaseBoth) ? 0.5 : 1,
                  transform: isPop ? 'scale(1.04)' : (isSelected || isAutoHighlight) ? 'scale(1.01)' : 'scale(1)',
                  boxShadow: isSelected 
                    ? '0 0 30px rgba(212,175,55,0.35), 0 6px 28px rgba(0,0,0,0.35)' 
                    : isAutoHighlight 
                      ? `0 0 25px ${vibe.color}40, 0 6px 28px rgba(0,0,0,0.3)` 
                      : '0 3px 20px rgba(0,0,0,0.25)',
                  position: 'relative',
                  backdropFilter: 'blur(10px)',
                  animation: isPop ? 'selectionPop 0.4s ease' : (song.version === 2 && song2Ready) ? 'song2Reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
                  overflow: 'hidden'
                }}
              >
                {/* ✅ REC 10: Heart burst micro-interaction */}
                {isPop && (
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 10 }}>
                    {['❤️','💛','✨'].map((e, i) => (
                      <span key={i} style={{
                        position: 'absolute',
                        fontSize: '24px',
                        animation: `heartBurst 0.6s ease-out ${i * 0.1}s forwards`,
                        left: `${(i - 1) * 20}px`
                      }}>{e}</span>
                    ))}
                  </div>
                )}

                {/* ✅ REC 4: "Más Popular" badge on Version 1 */}
                {index === 0 && (
                  <div style={{
                    position: 'absolute', top: '-1px', right: '50px',
                    background: 'linear-gradient(135deg, #d4af37, #f5d77a)',
                    color: '#1a3a2f',
                    padding: '4px 12px 6px',
                    borderRadius: '0 0 10px 10px',
                    fontSize: '10px',
                    fontWeight: '800',
                    letterSpacing: '0.5px',
                    boxShadow: '0 3px 10px rgba(212,175,55,0.4)',
                    zIndex: 3
                  }}>
                    ⭐ MÁS POPULAR
                  </div>
                )}

                {/* Radio indicator */}
                <div style={{
                  position: 'absolute', top: '14px', right: '14px',
                  width: '26px', height: '26px', borderRadius: '50%',
                  border: isSelected ? '3px solid #d4af37' : '3px solid rgba(255,255,255,0.25)',
                  background: isSelected ? '#d4af37' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s', zIndex: 2
                }}>
                  {isSelected && <span style={{color: '#1a3a2f', fontSize: '14px', fontWeight: 'bold'}}>✓</span>}
                </div>

                {/* Version badge */}
                <div style={{marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <span style={{
                    background: vibe.gradient, 
                    padding: '5px 14px', 
                    borderRadius: '18px', 
                    fontSize: '12px', 
                    fontWeight: 'bold',
                    boxShadow: `0 2px 10px ${vibe.color}40`
                  }}>
                    {vibe.emoji} Versión {index + 1}
                  </span>
                  <span style={{fontSize: '12px', color: vibe.color, fontWeight: '700'}}>
                    {vibe.label}
                  </span>
                </div>

                {/* ✅ REC 5: Compact album art (180px instead of 280px) */}
                <div style={{
                  height: '180px',
                  borderRadius: '12px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  marginBottom: '14px',
                  overflow: 'hidden',
                  position: 'relative',
                  animation: isPlaying ? 'glow 2s ease-in-out infinite' : 'none',
                  background: `linear-gradient(135deg, ${vibe.color}35, rgba(225,29,116,0.2))`,
                  boxShadow: `0 6px 24px ${vibe.color}20`,
                  border: `1px solid ${vibe.color}40`
                }}>
                  {song.imageUrl ? (
                    <img 
                      src={song.imageUrl} 
                      alt="" 
                      style={{
                        width: '100%', height: '100%', objectFit: 'cover',
                        transition: 'transform 0.5s',
                        transform: isPlaying ? 'scale(1.05)' : 'scale(1)'
                      }} 
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML = '<span style="font-size:56px">🎵</span>';
                      }}
                    />
                  ) : (
                    <span style={{fontSize: '56px'}}>🎵</span>
                  )}
                  
                  {/* Shine sweep */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 55%, transparent 60%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 4s ease-in-out infinite',
                    pointerEvents: 'none'
                  }} />
                  
                  {/* Playing equalizer overlay */}
                  {isPlaying && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      padding: '10px',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                      gap: '3px', height: '40px'
                    }}>
                      {[0.6, 0.5, 0.7, 0.8, 0.4].map((dur, i) => (
                        <div key={i} style={{
                          width: '4px', background: '#d4af37', borderRadius: '2px',
                          animation: `eq${(i % 3) + 1} ${dur}s ease-in-out infinite`
                        }} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Song title (no genre label — REC 5) */}
                <h3 style={{fontSize: '16px', marginBottom: '10px', fontWeight: 'bold'}}>
                  Para {recipientName}
                </h3>

                {/* ✅ REC 5: Collapsed lyrics — expand on tap */}
                {lyricsPreview.length > 0 && (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedLyrics(prev => ({...prev, [song.id]: !prev[song.id]}));
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.07)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      marginBottom: '12px',
                      borderLeft: `3px solid ${vibe.color}`,
                      cursor: 'pointer'
                    }}
                  >
                    {!isExpanded ? (
                      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        📝 <span style={{ fontStyle: 'italic' }}>"{lyricsPreview[0]}"</span>
                        <span style={{ color: vibe.color, fontSize: '11px', marginLeft: 'auto', whiteSpace: 'nowrap' }}>ver más ▼</span>
                      </p>
                    ) : (
                      <>
                        <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '1px' }}>
                          📝 Vista previa de la letra
                        </p>
                        {lyricsPreview.map((line, i) => (
                          <p key={i} style={{ fontSize: '12px', color: 'rgba(255,255,255,0.85)', margin: i < lyricsPreview.length - 1 ? '0 0 2px 0' : 0, fontStyle: 'italic', lineHeight: '1.4' }}>
                            "{line}"
                          </p>
                        ))}
                        <p style={{ fontSize: '11px', color: vibe.color, margin: '4px 0 0 0' }}>▲ cerrar</p>
                      </>
                    )}
                  </div>
                )}

                {/* Play button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handlePlay(song.id); }}
                  style={{
                    width: '100%', padding: '14px',
                    background: isPlaying 
                      ? 'linear-gradient(90deg, #f5d77a, #d4af37)' 
                      : vibe.gradient,
                    color: isPlaying ? '#1a3a2f' : 'white',
                    border: 'none', borderRadius: '10px',
                    cursor: 'pointer', fontWeight: 'bold', fontSize: '14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    transition: 'all 0.3s',
                    boxShadow: isPlaying ? '0 3px 16px rgba(212,175,55,0.5)' : `0 3px 14px ${vibe.color}35`,
                    animation: !isPlaying && !previewEnded[song.id] ? 'btnPulse 2s ease-in-out infinite' : 'none',
                    '--pulse-color': `${vibe.color}50`
                  }}
                >
                  <span style={{fontSize: '16px'}}>{isPlaying ? '⏸' : '▶'}</span>
                  {isPlaying ? 'Pausar' : 'Escuchar Preview'}
                </button>

                {/* Progress bar */}
                <div style={{marginTop: '8px', height: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden'}}>
                  <div style={{
                    height: '100%', 
                    background: isPlaying ? 'linear-gradient(90deg, #d4af37, #f5d77a)' : vibe.color, 
                    borderRadius: '3px', 
                    width: `${((currentTimes[song.id] || 0) / PREVIEW_DURATION) * 100}%`, 
                    transition: 'width 0.1s'
                  }} />
                </div>
                <p style={{fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '4px', textAlign: 'right'}}>
                  {formatTime(currentTimes[song.id] || 0)} / 0:20
                </p>

                {/* Price */}
                <div style={{
                  marginTop: '8px', paddingTop: '10px',
                  borderTop: `1px solid ${vibe.color}25`,
                  textAlign: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through' }}>
                      $39.99
                    </span>
                    <span style={{
                      background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      color: 'white'
                    }}>
                      AHORRA $10
                    </span>
                  </div>
                  <span style={{fontSize: '28px', fontWeight: '800', color: isSelected ? '#f5d77a' : 'white'}}>
                    ${singlePrice}
                  </span>
                </div>
              </div>
            );
          })}

          {/* ✅ Song 2 Loading Placeholder Card */}
          {song2Loading && songs.length < 2 && (
            <div
              style={{
                background: 'linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                border: '2px dashed rgba(168,85,247,0.35)',
                borderRadius: '20px',
                padding: '24px',
                position: 'relative',
                backdropFilter: 'blur(10px)',
                overflow: 'hidden',
                animation: 'fadeInUp 0.6s ease-out'
              }}
            >
              {/* Shimmer overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.06), transparent)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 2s ease-in-out infinite',
                borderRadius: '20px',
                pointerEvents: 'none'
              }} />

              {/* Version badge */}
              <div style={{marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                <span style={{
                  background: 'linear-gradient(135deg, rgba(168,85,247,0.3), rgba(168,85,247,0.15))',
                  padding: '7px 16px', borderRadius: '20px',
                  fontSize: '13px', fontWeight: 'bold',
                  border: '1px solid rgba(168,85,247,0.3)'
                }}>
                  🔥 Versión 2
                </span>
                <span style={{fontSize: '13px', color: '#a855f7', fontWeight: '700'}}>
                  Enérgica
                </span>
              </div>

              {/* Placeholder album art */}
              <div style={{
                height: '220px', borderRadius: '14px',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                marginBottom: '18px',
                background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(225,29,116,0.1))'
              }}>
                {/* Pulsing music icon */}
                <div style={{
                  width: '80px', height: '80px', borderRadius: '50%',
                  background: 'rgba(168,85,247,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'pulse 2s ease-in-out infinite',
                  marginBottom: '16px'
                }}>
                  <span style={{fontSize: '36px'}}>🎵</span>
                </div>
                <p style={{
                  color: 'rgba(255,255,255,0.7)', fontSize: '15px',
                  fontWeight: '600', margin: '0 0 4px 0'
                }}>
                  Creando tu segunda versión...
                </p>
                <p style={{
                  color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: 0
                }}>
                  Aparecerá aquí en un momento ✨
                </p>
              </div>

              {/* Placeholder progress */}
              <div style={{
                height: '6px', background: 'rgba(255,255,255,0.08)',
                borderRadius: '3px', overflow: 'hidden', marginTop: '12px'
              }}>
                <div style={{
                  height: '100%', width: '60%',
                  background: 'linear-gradient(90deg, #a855f7, #c084fc)',
                  borderRadius: '3px',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  backgroundSize: '200% 100%'
                }} />
              </div>
            </div>
          )}
        </div>

        {/* ===== BUNDLE COMBO CARD (below song cards) ===== */}
        {songs.length >= 2 && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', margin: '6px 0 16px', gap: '16px',
              animation: isVisible ? 'fadeInUp 0.8s ease-out 0.5s both' : 'none'
            }}>
              <div style={{flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(34,197,94,0.4))'}} />
              <span style={{
                color: '#22c55e', fontSize: '12px', fontWeight: 'bold',
                letterSpacing: '1px', textTransform: 'uppercase', whiteSpace: 'nowrap'
              }}>
                O LLÉVATE AMBAS
              </span>
              <div style={{flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(34,197,94,0.4), transparent)'}} />
            </div>

            <div
              onClick={selectBoth}
              style={{
                background: purchaseBoth 
                  ? 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(212,175,55,0.1))' 
                  : 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
                border: purchaseBoth ? '3px solid #22c55e' : '2px solid rgba(34,197,94,0.25)',
                borderRadius: '18px',
                padding: '20px',
                cursor: 'pointer',
                marginBottom: '20px',
                position: 'relative',
                transition: 'all 0.3s',
                transform: purchaseBoth ? 'scale(1.01)' : 'scale(1)',
                boxShadow: purchaseBoth ? '0 0 25px rgba(34,197,94,0.2)' : 'none',
                opacity: selectedSongId ? 0.65 : 1,
                animation: selectionPop === 'bundle' ? 'selectionPop 0.4s ease' : isVisible ? 'fadeInUp 0.8s ease-out 0.6s both' : 'none'
              }}
            >
              {/* Ribbon — #5: Reframe as low add-on cost */}
              <div style={{
                position: 'absolute', top: '-12px', left: '50%',
                transform: 'translateX(-50%)',
                background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                color: 'white', padding: '5px 18px', borderRadius: '16px',
                fontSize: '11px', fontWeight: 'bold',
                boxShadow: '0 3px 12px rgba(34,197,94,0.4)',
                whiteSpace: 'nowrap'
              }}>
                🎁 Segunda canción por solo ${(parseFloat(bundlePrice) - singlePrice).toFixed(0)} más
              </div>

              {/* Radio indicator */}
              <div style={{
                position: 'absolute', top: '16px', right: '16px',
                width: '26px', height: '26px', borderRadius: '50%',
                border: purchaseBoth ? '3px solid #22c55e' : '3px solid rgba(255,255,255,0.25)',
                background: purchaseBoth ? '#22c55e' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s'
              }}>
                {purchaseBoth && <span style={{color: 'white', fontSize: '14px', fontWeight: 'bold'}}>✓</span>}
              </div>

              {/* Overlapping album arts + pricing */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '6px' }}>
                <div style={{ display: 'flex', flexShrink: 0 }}>
                  {songs.slice(0, 2).map((song, i) => (
                    <div key={song.id} style={{
                      width: '64px', height: '64px', borderRadius: '12px',
                      overflow: 'hidden', border: '2px solid #0f2027',
                      marginLeft: i > 0 ? '-16px' : 0,
                      position: 'relative', zIndex: 2 - i,
                      background: `linear-gradient(135deg, ${VERSION_VIBES[i]?.color || '#3b82f6'}30, rgba(225,29,116,0.2))`,
                      boxShadow: `0 3px 10px ${VERSION_VIBES[i]?.color || '#3b82f6'}25`
                    }}>
                      {song.imageUrl ? (
                        <img src={song.imageUrl} alt="" style={{width: '100%', height: '100%', objectFit: 'cover'}}
                          onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="font-size:28px;display:flex;align-items:center;justify-content:center;height:100%">🎵</span>'; }}
                        />
                      ) : (
                        <span style={{fontSize: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>🎵</span>
                      )}
                    </div>
                  ))}
                </div>
                {/* #1: Gift experience framing */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 3px', fontSize: '16px', fontWeight: 'bold' }}>
                    🎁 El Regalo Completo
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.4' }}>
                    2 versiones únicas — porque un regalo así merece más de una opción
                  </p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ margin: '0 0 2px', color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through', fontSize: '13px' }}>
                    ${(singlePrice * 2).toFixed(2)}
                  </p>
                  <p style={{
                    margin: 0, fontSize: '26px', fontWeight: '800', lineHeight: 1,
                    color: purchaseBoth ? '#22c55e' : '#f5d77a'
                  }}>
                    ${bundlePrice}
                  </p>
                </div>
              </div>

              {/* #3: Social proof */}
              <p style={{
                margin: '12px 0 0', fontSize: '11px', color: 'rgba(255,255,255,0.5)',
                textAlign: 'center',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
              }}>
                <span style={{ color: '#22c55e', fontWeight: '700' }}>🔥 78% de clientes eligen esta opción</span>
              </p>
            </div>
          </>
        )}

        {/* ===== VIDEO TESTIMONIALS ===== */}
        <div style={{
          marginBottom: '20px',
          marginTop: '8px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.5s both' : 'none'
        }}>
          <p style={{ textAlign: 'center', fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '12px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase' }}>
            ⭐⭐⭐⭐⭐ Lo que dicen nuestros clientes
          </p>
          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
            {[
              { src: '/videos/testimonial3.mp4', id: 'tc1', name: 'Cliente feliz', poster: '' },
              { src: '/videos/testimonial1.mp4', id: 'tc2', name: 'Regalo perfecto', poster: '' }
            ].map((vid) => (
              <div key={vid.id} style={{
                width: '200px',
                height: '280px',
                borderRadius: '16px',
                overflow: 'hidden',
                position: 'relative',
                border: '2px solid rgba(212,175,55,0.3)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                cursor: 'pointer',
                flexShrink: 0
              }} onClick={() => handleTestimonialToggle(vid.id)}>
                <video
                  ref={el => videoTestimonialRefs.current[vid.id] = el}
                  src={vid.src}
                  playsInline
                  preload="metadata"
                  onEnded={() => setPlayingTestimonial(null)}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
                {playingTestimonial !== vid.id && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(transparent 40%, rgba(0,0,0,0.7))',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: 'rgba(201,24,74,0.85)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 15px rgba(201,24,74,0.5)'
                    }}>
                      <span style={{ fontSize: '20px', marginLeft: '3px' }}>▶</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p style={{
            textAlign: 'center',
            fontSize: '13px',
            color: '#f5d77a',
            marginTop: '10px',
            fontStyle: 'italic'
          }}>
            "Mi esposa lloró de felicidad... el mejor regalo que le he dado" ⭐⭐⭐⭐⭐
          </p>
        </div>

        {/* ===== Streamlined Checkout Section ===== */}
        <div style={{
          background: 'rgba(255,255,255,0.05)', borderRadius: '20px', padding: '20px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.7s both' : 'none',
          marginBottom: '100px' /* Space for sticky bar */
        }}>
          
          {/* WhatsApp Phone - Kept per user request (commitment driver) */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(37,211,102,0.08), rgba(37,211,102,0.03))',
            border: '1px solid rgba(37,211,102,0.25)',
            borderRadius: '14px',
            padding: '14px 16px',
            marginBottom: '16px'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px'}}>
              <span style={{fontSize: '18px'}}>📱</span>
              <p style={{margin: 0, color: 'rgba(255,255,255,0.85)', fontSize: '13px', fontWeight: '600'}}>
                ¿Quieres recibir tu canción por WhatsApp?
              </p>
              <span style={{
                color: 'rgba(255,255,255,0.4)', fontSize: '10px', 
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px',
                padding: '2px 6px', whiteSpace: 'nowrap'
              }}>
                Opcional
              </span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'rgba(255,255,255,0.07)', borderRadius: '10px',
                padding: '0 12px', border: '1px solid rgba(37,211,102,0.2)',
                flex: 1
              }}>
                <span style={{color: 'rgba(255,255,255,0.5)', fontSize: '13px', userSelect: 'none'}}>+</span>
                <input
                  type="tel"
                  value={whatsappPhone}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^\d\s\-\+\(\)]/g, '');
                    setWhatsappPhone(val);
                  }}
                  placeholder="1 (818) 555-1234"
                  maxLength={20}
                  style={{
                    width: '100%', padding: '11px 0',
                    background: 'transparent', border: 'none',
                    color: 'white', fontSize: '14px', outline: 'none'
                  }}
                />
              </div>
              {whatsappPhone.replace(/\D/g, '').length >= 10 && (
                <span style={{color: '#25D366', fontSize: '18px'}}>✓</span>
              )}
            </div>
            <p style={{margin: '6px 0 0 0', color: 'rgba(255,255,255,0.35)', fontSize: '11px'}}>
              Te enviaremos el link de descarga directo a tu WhatsApp 💬
            </p>
          </div>

          {/* ✅ REC 3: Coupon hidden behind toggle link */}
          {!showCouponInput ? (
            <p 
              onClick={() => setShowCouponInput(true)}
              style={{
                textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '13px',
                cursor: 'pointer', marginBottom: '16px', textDecoration: 'underline',
                textUnderlineOffset: '3px'
              }}
            >
              ¿Tienes un código de cupón?
            </p>
          ) : (
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap'}}>
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="Código de cupón"
                disabled={!!couponApplied}
                style={{
                  flex: 1, minWidth: '160px', padding: '12px 14px', 
                  background: 'rgba(255,255,255,0.07)', 
                  border: '1px solid rgba(255,255,255,0.15)', 
                  borderRadius: '10px', color: 'white', fontSize: '14px'
                }}
              />
              {!couponApplied ? (
                <button 
                  onClick={handleApplyCoupon}
                  disabled={isLoadingCoupon || !couponCode.trim()}
                  style={{
                    padding: '12px 18px', 
                    background: couponCode.trim() ? '#f5d77a' : 'rgba(255,255,255,0.08)', 
                    color: couponCode.trim() ? '#1a3a2f' : 'rgba(255,255,255,0.3)', 
                    border: 'none', borderRadius: '10px', 
                    cursor: couponCode.trim() ? 'pointer' : 'not-allowed', 
                    fontWeight: 'bold', fontSize: '14px'
                  }}
                >
                  {isLoadingCoupon ? '...' : 'Aplicar'}
                </button>
              ) : (
                <span style={{
                  color: '#22c55e', fontWeight: 'bold',
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '12px 16px', background: 'rgba(34,197,94,0.1)', borderRadius: '10px',
                  fontSize: '13px'
                }}>
                  ✓ {couponApplied.code}
                </span>
              )}
            </div>
          )}
          {couponError && (
            <p style={{color: '#ef4444', fontSize: '13px', marginTop: '-8px', marginBottom: '12px'}}>{couponError}</p>
          )}

          {/* ✅ What you get checklist (compact) */}
          <div style={{
            background: 'rgba(212,175,55,0.06)',
            border: '1px solid rgba(212,175,55,0.15)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
              {[
                { icon: '🎵', text: 'Canción completa ~2 min' },
                { icon: '⚡', text: 'Descarga instantánea' },
                { icon: '💬', text: 'Envío por WhatsApp' },
                { icon: '♾️', text: 'Tuya para siempre' },
                { icon: '❤️', text: 'Personalizada' },
                { icon: '🔒', text: 'Pago seguro Stripe' }
              ].map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  fontSize: '12px', color: 'rgba(255,255,255,0.7)'
                }}>
                  <span style={{ fontSize: '13px' }}>{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ✅ REC 9: Gift-framed checkout button */}
          <button
            onClick={handleCheckout}
            disabled={isCheckingOut || !hasSelection}
            style={{
              width: '100%', padding: '20px',
              background: hasSelection 
                ? 'linear-gradient(90deg, #e11d74, #c026d3)' 
                : 'rgba(255,255,255,0.08)',
              color: hasSelection ? 'white' : 'rgba(255,255,255,0.3)',
              border: 'none', borderRadius: '14px',
              fontSize: '18px', fontWeight: 'bold',
              cursor: hasSelection ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s',
              boxShadow: hasSelection ? '0 4px 25px rgba(225,29,116,0.5)' : 'none'
            }}
          >
            {isCheckingOut ? (
              <span>⏳ Procesando...</span>
            ) : !hasSelection ? (
              <span>👆 Selecciona una opción</span>
            ) : isFree ? (
              <span>🎉 Descargar Gratis</span>
            ) : (
              <span>🎁 Regalar Canción a {recipientName} — ${purchaseBoth ? bundlePrice : singlePrice}</span>
            )}
          </button>

          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '10px', marginTop: '10px', lineHeight: 1.5, maxWidth: 320, marginLeft: 'auto', marginRight: 'auto' }}>
            Al comprar aceptas que todas las ventas son finales. Escucha la vista previa antes de comprar.
          </p>

          <div style={{display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '14px', flexWrap: 'wrap'}}>
            {['🔒 Pago Seguro', '⚡ Instantánea', '✨ Premium'].map((badge, i) => (
              <span key={i} style={{color: 'rgba(255,255,255,0.45)', fontSize: '12px'}}>{badge}</span>
            ))}
          </div>
        </div>

        <p style={{textAlign: 'center', marginTop: '30px', color: 'rgba(255,255,255,0.3)', fontSize: '12px'}}>
          RegalosQueCantan © {new Date().getFullYear()}
        </p>

        {/* ✅ Song 2 Ready Toast */}
        {song2Ready && (
          <div style={{
            position: 'fixed', bottom: '100px', left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
            color: 'white', padding: '14px 28px', borderRadius: '50px',
            fontSize: '15px', fontWeight: 'bold',
            boxShadow: '0 8px 30px rgba(124,58,237,0.5)',
            zIndex: 100,
            display: 'flex', alignItems: 'center', gap: '8px',
            animation: 'toastIn 3.5s ease-in-out forwards'
          }}>
            <span style={{fontSize: '20px'}}>✨</span>
            ¡Versión 2 lista! Escúchala arriba 🔥
          </div>
        )}

        {/* ===== REC 2: STICKY BOTTOM CHECKOUT BAR ===== */}
        {hasSelection && (
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'linear-gradient(180deg, rgba(15,32,39,0.0) 0%, rgba(15,32,39,0.95) 15%, #0f2027 100%)',
            padding: '20px 16px 16px',
            zIndex: 50,
            animation: 'stickySlideUp 0.4s ease-out'
          }}>
            <div style={{ maxWidth: '500px', margin: '0 auto' }}>
              <button
                onClick={handleCheckout}
                disabled={isCheckingOut}
                style={{
                  width: '100%',
                  padding: '16px 24px',
                  background: 'linear-gradient(90deg, #e11d74, #c026d3)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '14px',
                  fontSize: '17px',
                  fontWeight: 'bold',
                  cursor: isCheckingOut ? 'not-allowed' : 'pointer',
                  boxShadow: '0 -2px 20px rgba(225,29,116,0.4), 0 4px 20px rgba(225,29,116,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.3s'
                }}
              >
                {isCheckingOut ? (
                  <span>⏳ Procesando...</span>
                ) : isFree ? (
                  <span>🎉 Descargar Gratis</span>
                ) : (
                  <>
                    <span>🎁 Regalar a {recipientName}</span>
                    <span style={{
                      background: 'rgba(255,255,255,0.2)',
                      padding: '3px 10px',
                      borderRadius: '8px',
                      fontSize: '15px'
                    }}>
                      ${purchaseBoth ? bundlePrice : singlePrice}
                    </span>
                  </>
                )}
              </button>
              <p style={{
                textAlign: 'center',
                fontSize: '11px',
                color: 'rgba(255,255,255,0.4)',
                marginTop: '6px',
                marginBottom: 0
              }}>
                {purchaseBoth ? '2 canciones' : getSelectionLabel()} • 🔒 Pago seguro
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
