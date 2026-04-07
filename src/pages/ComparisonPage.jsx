import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App';
import { createCheckout, supabase, checkSongStatus } from '../services/api';
import genres from '../config/genres';
import { trackStep } from '../services/tracking';
import ExitIntentPopup from '../components/ExitIntentPopup';

// Preview settings
const PREVIEW_START = 10;
const PREVIEW_DURATION = 35;
const PREVIEW_END = PREVIEW_START + PREVIEW_DURATION;

// Helper to get static genre image path
const getGenreImagePath = (genre) => {
  if (!genre) return null;
  return `/images/album-art/${genre}.jpg`;
};

// ✅ NEW: Version personality - VIBRANT colors
const VERSION_VIBES = [
  { label: 'Versión 1', emoji: '🎵', color: '#4f9cf7', gradient: 'linear-gradient(135deg, #2563eb, #3b82f6)', bgTint: 'rgba(59,130,246,0.12)' },
  { label: 'Versión 2', emoji: '🎶', color: '#a855f7', gradient: 'linear-gradient(135deg, #7c3aed, #9333ea)', bgTint: 'rgba(168,85,247,0.12)' }
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
  const [autoPlayBlocked, setAutoPlayBlocked] = useState(false); // true when browser blocked auto-play
  const [autoPlayingIndex, setAutoPlayingIndex] = useState(-1); // -1 = not auto-playing, 0 = song 1, 1 = song 2
  
  // ✅ NEW: Song 2 background generation state
  const [song2Loading, setSong2Loading] = useState(false);
  const [song2Ready, setSong2Ready] = useState(false);
  const song2PollRef = useRef(null);
  const song2Started = useRef(false);
  
  // ✅ NEW: Entrance animation state
  const [isVisible, setIsVisible] = useState(false);

  // Track how many audio elements are ready (deduplicated — only counts first canplay per element)
  const [audioReadyCount, setAudioReadyCount] = useState(0);
  const audioReadySet = useRef(new Set()); // Track which audio IDs already fired canplay
  const autoPlayTimerRef = useRef(null); // Persistent timer ref so effect cleanup doesn't kill it
  
  // ✅ NEW: Lyrics expand state
  const [expandedLyrics, setExpandedLyrics] = useState({});
  
  // Selection state
  const [selectedSongId, setSelectedSongId] = useState(null);
  const [purchaseBoth, setPurchaseBoth] = useState(false);
  
  // Coupon state (kept for deep-link/URL coupon support)
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(null);
  
  // Removed Valentine countdown
  const videoTestimonialRefs = useRef({});
  const [playingTestimonial, setPlayingTestimonial] = useState(null);

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
  const whatsappSaveTimer = useRef(null);

  // Auto-save WhatsApp phone to DB when user types a valid number (10+ digits)
  useEffect(() => {
    const cleanPhone = whatsappPhone.replace(/\D/g, '');
    if (cleanPhone.length >= 10 && songs?.length > 0) {
      // Debounce: wait 1 second after user stops typing
      clearTimeout(whatsappSaveTimer.current);
      whatsappSaveTimer.current = setTimeout(async () => {
        try {
          for (const song of songs) {
            await supabase
              .from('songs')
              .update({ whatsapp_phone: cleanPhone })
              .eq('id', song.id);
          }
          localStorage.setItem('rqc_whatsapp_phone', cleanPhone);
        } catch (err) {
          // Silent fail — phone will still be saved at checkout as backup
        }
      }, 1000);
    }
    return () => clearTimeout(whatsappSaveTimer.current);
  }, [whatsappPhone, songs]);

  // Checkout state
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  
  const audioRefs = useRef({});
  const checkoutCtaRef = useRef(null);
  const videoAddonRef = useRef(null);

  // Safely get genre display name
  const genreConfig = genres?.[formData?.genre];
  const genreName = genreConfig?.name || formData?.genre || 'Género';

  // Pricing
  const baseSinglePrice = 29.99;
  const baseBundlePrice = 39.99;
  const videoAddonPrice = 9.99;
  const isFree = couponApplied?.free || false;
  const discountPercent = couponApplied?.discount || 0;
  const hasDiscount = !isFree && discountPercent > 0;
  const singlePrice = hasDiscount ? parseFloat((baseSinglePrice * (1 - discountPercent / 100)).toFixed(2)) : baseSinglePrice;
  const bundlePrice = hasDiscount ? parseFloat((baseBundlePrice * (1 - discountPercent / 100)).toFixed(2)) : baseBundlePrice;
  const bundleSavings = (baseSinglePrice * 2) - baseBundlePrice;

  // Video add-on toggle
  const [videoAddon, setVideoAddon] = useState(false);

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
          genre: song.genre,
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
        const s1 = songData.song1;
        loadedSongs.push({
          id: s1.id,
          version: 1,
          audioUrl: s1.audio_url || s1.audioUrl,
          previewUrl: s1.preview_url || s1.previewUrl || s1.audio_url || s1.audioUrl,
          imageUrl: s1.image_url || s1.imageUrl,
          genre: s1.genre,
          lyrics: s1.lyrics
        });
        if (songData?.song2) {
          const s2 = songData.song2;
          loadedSongs.push({
            id: s2.id,
            version: 2,
            audioUrl: s2.audio_url || s2.audioUrl,
            previewUrl: s2.preview_url || s2.previewUrl || s2.audio_url || s2.audioUrl,
            imageUrl: s2.image_url || s2.imageUrl,
            genre: s2.genre,
            lyrics: s2.lyrics
          });
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

  // ✅ Auto-play full sequential preview (Song 1 → Song 2)
  // Uses a persistent timer ref so repeated audioReadyCount changes don't reset the timer
  useEffect(() => {
    if (autoPlayed || songs.length === 0 || loading) return;
    if (autoPlayTimerRef.current) return; // Timer already scheduled — don't reset

    const firstSong = songs[0];
    const audio = audioRefs.current[firstSong?.id];
    if (!audio || audio.readyState < 3) return; // Wait until HAVE_FUTURE_DATA (can play)

    autoPlayTimerRef.current = setTimeout(() => {
      autoPlayTimerRef.current = null;
      try {
        audio.currentTime = PREVIEW_START;
        audio.volume = 0.7;
        const playPromise = audio.play();

        if (playPromise !== undefined) {
          playPromise.then(() => {
            setPlayingId(firstSong.id);
            setAutoPlayingIndex(0);
          }).catch(() => {
            // Autoplay blocked by browser
            setAutoPlayed(true);
            setAutoPlayBlocked(true);
          });
        }
      } catch (e) {
        setAutoPlayed(true);
        setAutoPlayBlocked(true);
      }
    }, 1500);

    // Only clear on unmount, NOT on re-runs
    return () => {
      if (autoPlayTimerRef.current) {
        clearTimeout(autoPlayTimerRef.current);
        autoPlayTimerRef.current = null;
      }
    };
  }, [songs, loading, autoPlayed, audioReadyCount]);

  // ✅ Auto-play Song 2 when it arrives late (fast funnel: Song 1 finished but Song 2 wasn't ready yet)
  useEffect(() => {
    if (!song2Ready || autoPlayed || autoPlayingIndex !== 0) return;
    if (songs.length < 2) return;
    // Only trigger if Song 1 already finished playing (playingId is null and Song 1 preview ended)
    const firstSong = songs[0];
    if (playingId || !previewEnded[firstSong?.id]) return;

    const secondSong = songs[1];
    const nextAudio = audioRefs.current[secondSong?.id];
    if (!nextAudio || nextAudio.readyState < 3) return;

    const timer = setTimeout(() => {
      try {
        nextAudio.currentTime = PREVIEW_START;
        nextAudio.volume = 0.7;
        nextAudio.play().then(() => {
          setPlayingId(secondSong.id);
          setAutoPlayingIndex(1);
          setCurrentTimes(prev => ({ ...prev, [secondSong.id]: 0 }));
          setPreviewEnded(prev => ({ ...prev, [secondSong.id]: false }));
        }).catch(() => {
          setAutoPlayingIndex(-1);
          setAutoPlayed(true);
        });
      } catch (e) {
        setAutoPlayingIndex(-1);
        setAutoPlayed(true);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [song2Ready, songs, audioReadyCount, autoPlayed, autoPlayingIndex, playingId, previewEnded]);

  const handlePlay = (songId) => {
    try {
      // Dismiss auto-play blocked banner on manual interaction
      setAutoPlayBlocked(false);
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
      .slice(0, 10);
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

      // Save WhatsApp phone if provided (uses RPC to bypass RLS)
      const cleanPhone = whatsappPhone.replace(/\D/g, '');
      if (cleanPhone) {
        localStorage.setItem('rqc_whatsapp_phone', cleanPhone);
        try {
          for (const songId of songIdsToCheckout) {
            const { error: rpcErr } = await supabase.rpc('save_whatsapp_phone', {
              song_id: songId,
              phone: cleanPhone
            });
            if (rpcErr && import.meta.env.DEV) {
              console.warn('Could not save WhatsApp phone for song:', songId, rpcErr);
            }
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

      // 🔥 Meta Pixel: InitiateCheckout when user actually clicks buy and checkout is created
      const checkoutValue = getCurrentPrice();
      trackStep('checkout_clicked', { value: checkoutValue, num_items: songIdsToCheckout.length, content_ids: songIdsToCheckout });

      const result = await createCheckout(songIdsToCheckout, formData?.email, codeToSend, purchaseBoth, '', videoAddon);

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
    // 🔥 Meta Pixel: AddToCart when user selects a song
    trackStep('song_selected', { value: 29.99, content_ids: [songId], num_items: 1 });
    // Auto-scroll to checkout CTA
    setTimeout(() => {
      videoAddonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
  };

  const selectBoth = () => {
    setPurchaseBoth(true);
    setSelectedSongId(null);
    // 🔥 Meta Pixel: AddToCart when user selects both songs
    trackStep('song_selected', { value: 39.99, content_ids: songs.map(s => s.id), num_items: 2 });
    // Auto-scroll to checkout CTA
    setTimeout(() => {
      videoAddonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
  };

  const getSelectionLabel = () => {
    const videoLabel = videoAddon ? ' + Video' : '';
    if (purchaseBoth) return `2 Canciones${videoLabel}`;
    if (selectedSongId) {
      const song = songs.find(s => s.id === selectedSongId);
      return `1 Canción (Versión ${song?.version || 1})${videoLabel}`;
    }
    return null;
  };

  const getCurrentPrice = () => {
    if (isFree) return 0;
    const base = purchaseBoth ? bundlePrice : singlePrice;
    return videoAddon ? base + videoAddonPrice : base;
  };

  // ==================== RENDER ====================

  if (loading) {
    return (
      <div style={{backgroundColor: '#181114', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
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
      <div style={{backgroundColor: '#181114', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
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
    <div style={{background: '#0f0b0e', color: 'white', minHeight: '100vh', padding: '0 0 100px 0', overflow: 'hidden'}}>

      {/* ✅ Minimal CSS Animations */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes eq1 { 0%, 100% { height: 8px; } 50% { height: 20px; } }
        @keyframes eq2 { 0%, 100% { height: 14px; } 50% { height: 6px; } }
        @keyframes eq3 { 0%, 100% { height: 10px; } 50% { height: 22px; } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes glimmer { 0% { left: -100%; } 100% { left: 200%; } }
        @keyframes borderGlow { 0%, 100% { box-shadow: 0 0 15px rgba(34,197,94,0.2), 0 0 30px rgba(34,197,94,0.05); } 50% { box-shadow: 0 0 25px rgba(34,197,94,0.35), 0 0 50px rgba(34,197,94,0.1); } }
        @keyframes videoBorderGlow { 0%, 100% { box-shadow: 0 0 15px rgba(139,92,246,0.2), 0 0 30px rgba(139,92,246,0.05); } 50% { box-shadow: 0 0 25px rgba(139,92,246,0.35), 0 0 50px rgba(139,92,246,0.1); } }
        @keyframes song2Reveal { 0% { opacity: 0; transform: scale(0.95) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes toastIn { 0% { opacity: 0; transform: translate(-50%, 20px); } 15% { opacity: 1; transform: translate(-50%, 0); } 85% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -10px); } }
        @keyframes kbSlide1 { 0%{transform:scale(1);opacity:1} 12%{transform:scale(1.1) translate(-1%,1%);opacity:1} 14.28%{opacity:0} 100%{opacity:0} }
        @keyframes kbSlide2 { 0%{opacity:0} 14.28%{opacity:0} 14.29%{transform:scale(1.05);opacity:1} 26%{transform:scale(1.15) translate(1%,-1%);opacity:1} 28.57%{opacity:0} 100%{opacity:0} }
        @keyframes kbSlide3 { 0%{opacity:0} 28.57%{opacity:0} 28.58%{transform:scale(1);opacity:1} 40%{transform:scale(1.12) translate(-2%,1%);opacity:1} 42.86%{opacity:0} 100%{opacity:0} }
        @keyframes kbSlide4 { 0%{opacity:0} 42.86%{opacity:0} 42.87%{transform:scale(1.08);opacity:1} 54%{transform:scale(1.18) translate(1%,2%);opacity:1} 57.14%{opacity:0} 100%{opacity:0} }
        @keyframes kbSlide5 { 0%{opacity:0} 57.14%{opacity:0} 57.15%{transform:scale(1);opacity:1} 68%{transform:scale(1.1) translate(-1%,-1%);opacity:1} 71.43%{opacity:0} 100%{opacity:0} }
        @keyframes kbSlide6 { 0%{opacity:0} 71.43%{opacity:0} 71.44%{transform:scale(1.05);opacity:1} 82%{transform:scale(1.15) translate(2%,1%);opacity:1} 85.71%{opacity:0} 100%{opacity:0} }
        @keyframes kbSlide7 { 0%{opacity:0} 85.71%{opacity:0} 85.72%{transform:scale(1);opacity:1} 96%{transform:scale(1.12) translate(-1%,2%);opacity:1} 100%{opacity:0} }
        @keyframes kenBurns1 { 0%{transform:scale(1) translate(0,0);opacity:1} 12.5%{transform:scale(1.12) translate(-2%,1%);opacity:1} 14.3%{opacity:0} 100%{opacity:0} }
        @keyframes kenBurns2 { 0%{opacity:0} 12.5%{opacity:0} 14.3%{transform:scale(1.08) translate(2%,-1%);opacity:1} 26.8%{transform:scale(1.2) translate(-1%,2%);opacity:1} 28.6%{opacity:0} 100%{opacity:0} }
        @keyframes kenBurns3 { 0%{opacity:0} 26.8%{opacity:0} 28.6%{transform:scale(1) translate(-1%,0);opacity:1} 41.1%{transform:scale(1.15) translate(2%,-2%);opacity:1} 42.9%{opacity:0} 100%{opacity:0} }
        @keyframes kenBurns4 { 0%{opacity:0} 41.1%{opacity:0} 42.9%{transform:scale(1.05) translate(0,1%);opacity:1} 55.4%{transform:scale(1.18) translate(-3%,2%);opacity:1} 57.1%{opacity:0} 100%{opacity:0} }
        @keyframes kenBurns5 { 0%{opacity:0} 55.4%{opacity:0} 57.1%{transform:scale(1) translate(1%,0);opacity:1} 69.6%{transform:scale(1.14) translate(-2%,-1%);opacity:1} 71.4%{opacity:0} 100%{opacity:0} }
        @keyframes kenBurns6 { 0%{opacity:0} 69.6%{opacity:0} 71.4%{transform:scale(1.1) translate(1%,1%);opacity:1} 83.9%{transform:scale(1.2) translate(-2%,0);opacity:1} 85.7%{opacity:0} 100%{opacity:0} }
        @keyframes kenBurns7 { 0%{opacity:0} 83.9%{opacity:0} 85.7%{transform:scale(1.05) translate(0,-1%);opacity:1} 98.2%{transform:scale(1.16) translate(2%,1%);opacity:1} 100%{opacity:0} }
        @keyframes progressPreview { 0%{width:0%} 100%{width:100%} }
        @keyframes noteFloat { 0%{transform:translateY(0) rotate(0deg);opacity:0.7} 50%{transform:translateY(-8px) rotate(10deg);opacity:1} 100%{transform:translateY(0) rotate(0deg);opacity:0.7} }
        @keyframes videoProgress { 0%{width:0%} 100%{width:100%} }
      `}</style>

      {/* Audio elements (hidden) */}
      {songs.map(song => (
        <audio
          key={song.id}
          ref={el => audioRefs.current[song.id] = el}
          src={song.audioUrl || song.previewUrl}
          preload="auto"
          onLoadedMetadata={(e) => { if (e.target) e.target.currentTime = PREVIEW_START; }}
          onCanPlay={() => {
            if (!audioReadySet.current.has(song.id)) {
              audioReadySet.current.add(song.id);
              setAudioReadyCount(c => c + 1);
            }
          }}
          onTimeUpdate={(e) => handleTimeUpdate(song.id, e.target)}
          onEnded={() => setPlayingId(null)}
        />
      ))}

      <div style={{
        maxWidth: '680px',
        margin: '0 auto',
        padding: '24px 16px 0',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'all 0.6s ease-out'
      }}>

        {/* ══════════════════════════════════════════════════════
            SECTION 1: Header — Recipient name + instructions
            ══════════════════════════════════════════════════════ */}
        <div style={{textAlign: 'center', marginBottom: '28px', animation: 'fadeIn 0.6s ease-out'}}>
          <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: '0 0 4px', letterSpacing: '2px', textTransform: 'uppercase'}}>
            Canción personalizada para
          </p>
          <h1 style={{fontSize: '28px', fontWeight: '800', margin: '0 0 6px', color: '#f74da6'}}>
            {recipientName}
          </h1>
          <p style={{fontSize: '13px', color: 'rgba(255,255,255,0.45)', margin: 0}}>
            Escucha y elige tu versión favorita
          </p>

          {/* Auto-play blocked banner */}
          {autoPlayBlocked && !playingId && (
            <div style={{
              marginTop: '14px', background: 'rgba(242,13,128,0.1)',
              border: '1px solid rgba(242,13,128,0.2)', borderRadius: '10px',
              padding: '10px 16px', display: 'inline-block'
            }}>
              <p style={{fontSize: '14px', fontWeight: '700', margin: 0, color: '#f74da6'}}>
                👇 Toca para escuchar · 🔊 Sube el volumen
              </p>
            </div>
          )}

          {/* Auto-play indicator */}
          {autoPlayingIndex >= 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              background: 'rgba(242,13,128,0.1)', padding: '6px 16px',
              borderRadius: '20px', fontSize: '13px', color: '#f74da6', marginTop: '12px',
            }}>
              <div style={{display: 'flex', alignItems: 'flex-end', gap: '2px', height: '14px'}}>
                <div style={{width: '3px', background: 'currentColor', borderRadius: '2px', animation: 'eq1 0.6s ease-in-out infinite'}} />
                <div style={{width: '3px', background: 'currentColor', borderRadius: '2px', animation: 'eq2 0.5s ease-in-out infinite'}} />
                <div style={{width: '3px', background: 'currentColor', borderRadius: '2px', animation: 'eq3 0.7s ease-in-out infinite'}} />
              </div>
              Reproduciendo Versión {autoPlayingIndex + 1}...
            </div>
          )}
        </div>


        {/* ══════════════════════════════════════════════════════
            SECTION 2: Song Cards — Play, listen, select
            ══════════════════════════════════════════════════════ */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: songs.length >= 2 ? 'repeat(2, 1fr)' : '1fr',
          gap: '14px',
          marginBottom: '16px',
          animation: 'fadeIn 0.6s ease-out 0.15s both'
        }}>
          {songs.map((song, index) => {
            const isSelected = selectedSongId === song.id;
            const isOtherSelected = (selectedSongId && !isSelected) || purchaseBoth;
            const isPlaying = playingId === song.id;
            const vibe = VERSION_VIBES[index] || VERSION_VIBES[0];

            return (
              <div
                key={song.id}
                onClick={() => selectSong(song.id)}
                style={{
                  background: isSelected
                    ? 'rgba(242,13,128,0.12)'
                    : 'rgba(255,255,255,0.06)',
                  border: isSelected
                    ? '2px solid #f74da6'
                    : '2px solid rgba(255,255,255,0.1)',
                  borderRadius: '16px',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  opacity: isOtherSelected ? 0.5 : 1,
                  position: 'relative',
                  animation: (song.version === 2 && song2Ready) ? 'song2Reveal 0.5s ease-out' : undefined
                }}
              >
                {/* Selection indicator */}
                <div style={{
                  position: 'absolute', top: '12px', right: '12px',
                  width: '24px', height: '24px', borderRadius: '50%',
                  border: isSelected ? '2px solid #f74da6' : '2px solid rgba(255,255,255,0.25)',
                  background: isSelected ? '#f74da6' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s'
                }}>
                  {isSelected && <span style={{color: 'white', fontSize: '13px', fontWeight: 'bold'}}>✓</span>}
                </div>

                {/* Version label */}
                <span style={{
                  background: vibe.gradient,
                  padding: '4px 12px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  display: 'inline-block',
                  marginBottom: '12px'
                }}>
                  {vibe.emoji} {vibe.label}
                </span>

                {/* Album art */}
                <div style={{
                  aspectRatio: '1', borderRadius: '12px',
                  overflow: 'hidden', marginBottom: '12px',
                  position: 'relative',
                  background: `linear-gradient(135deg, ${vibe.color}30, rgba(225,29,116,0.15))`
                }}>
                  {(() => {
                    const genreKey = song.genre || formData?.genre;
                    const staticImg = getGenreImagePath(genreKey);
                    const imgSrc = staticImg || song.imageUrl;
                    return imgSrc ? (
                      <img src={imgSrc} alt=""
                        style={{width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.4s', transform: isPlaying ? 'scale(1.03)' : 'scale(1)'}}
                        onError={(e) => {
                          if (song.imageUrl && e.target.src !== song.imageUrl) { e.target.src = song.imageUrl; }
                          else { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span style="font-size:48px">🎵</span>'; }
                        }}
                      />
                    ) : <span style={{fontSize: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>🎵</span>;
                  })()}

                  {/* Playing equalizer overlay */}
                  {isPlaying && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '3px', height: '40px'
                    }}>
                      {[0.6, 0.5, 0.7, 0.8, 0.4].map((dur, i) => (
                        <div key={i} style={{width: '3px', background: '#f20d80', borderRadius: '2px', animation: `eq${(i % 3) + 1} ${dur}s ease-in-out infinite`}} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Play button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handlePlay(song.id); }}
                  style={{
                    width: '100%', padding: '12px',
                    background: isPlaying ? '#f74da6' : vibe.gradient,
                    color: 'white', border: 'none', borderRadius: '10px',
                    cursor: 'pointer', fontWeight: 'bold', fontSize: '14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    transition: 'all 0.2s',
                  }}
                >
                  {isPlaying ? '⏸ Pausar' : '▶ Escuchar'}
                </button>

                {/* Progress bar */}
                <div style={{marginTop: '8px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden'}}>
                  <div style={{
                    height: '100%', background: vibe.color, borderRadius: '2px',
                    width: `${((currentTimes[song.id] || 0) / PREVIEW_DURATION) * 100}%`, transition: 'width 0.1s'
                  }} />
                </div>
                <div style={{display: 'flex', justifyContent: 'space-between', marginTop: '4px'}}>
                  <span style={{fontSize: '11px', color: 'rgba(255,255,255,0.4)'}}>
                    {formatTime(currentTimes[song.id] || 0)} / {formatTime(PREVIEW_DURATION)}
                  </span>
                  <span style={{fontSize: '14px', fontWeight: '800', color: isSelected ? '#f74da6' : 'white'}}>
                    {hasDiscount && <span style={{textDecoration: 'line-through', color: 'rgba(255,255,255,0.35)', fontSize: '12px', marginRight: '6px'}}>${baseSinglePrice}</span>}
                    <span style={{color: hasDiscount ? '#4ade80' : (isSelected ? '#f74da6' : 'white')}}>${isFree ? 'GRATIS' : singlePrice.toFixed(2)}</span>
                  </span>
                </div>

                {/* Lyrics link (collapsed) */}
                {getLyricsPreview(song.lyrics).length > 0 && (
                  <div
                    onClick={(e) => { e.stopPropagation(); setExpandedLyrics(prev => ({...prev, [song.id]: !prev[song.id]})); }}
                    style={{
                      marginTop: '8px', padding: '8px 10px',
                      background: 'rgba(255,255,255,0.05)', borderRadius: '8px',
                      borderLeft: `2px solid ${vibe.color}40`, cursor: 'pointer'
                    }}
                  >
                    {expandedLyrics[song.id] ? (
                      <>
                        {getLyricsPreview(song.lyrics).slice(0, 8).map((line, i) => (
                          <p key={i} style={{fontSize: '12px', color: 'rgba(255,255,255,0.7)', margin: i < 7 ? '0 0 2px' : 0, fontStyle: 'italic', lineHeight: 1.4}}>
                            {line}
                          </p>
                        ))}
                        <p style={{fontSize: '11px', color: vibe.color, margin: '4px 0 0'}}>▲ Cerrar letra</p>
                      </>
                    ) : (
                      <p style={{fontSize: '11px', color: vibe.color, margin: 0}}>📝 Ver letra...</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Song 2 Loading Placeholder */}
          {song2Loading && songs.length < 2 && (
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '2px dashed rgba(168,85,247,0.3)',
              borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', minHeight: '280px',
              animation: 'fadeIn 0.5s ease-out'
            }}>
              <div style={{width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(168,85,247,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pulse 2s infinite', marginBottom: '12px'}}>
                <span style={{fontSize: '28px'}}>🎵</span>
              </div>
              <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '14px', fontWeight: '600', margin: '0 0 4px'}}>
                Creando versión 2...
              </p>
              <p style={{color: 'rgba(255,255,255,0.35)', fontSize: '12px', margin: 0}}>Un momento ✨</p>
              <div style={{width: '80%', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden', marginTop: '16px'}}>
                <div style={{height: '100%', width: '60%', background: '#a855f7', borderRadius: '2px', animation: 'shimmer 1.5s infinite', backgroundSize: '200% 100%'}} />
              </div>
            </div>
          )}
        </div>


        {/* ══════════════════════════════════════════════════════
            SECTION 3: Bundle Option — Both for $39.99
            ══════════════════════════════════════════════════════ */}
        {songs.length >= 2 && (
          <div
            onClick={selectBoth}
            style={{
              background: purchaseBoth
                ? 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.08))'
                : 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(255,255,255,0.03))',
              border: purchaseBoth ? '2px solid #22c55e' : '2px solid rgba(34,197,94,0.25)',
              borderRadius: '18px', padding: '22px',
              cursor: 'pointer', marginBottom: '16px',
              position: 'relative', overflow: 'hidden',
              transition: 'all 0.3s', opacity: selectedSongId ? 0.55 : 1,
              animation: purchaseBoth ? 'borderGlow 2.5s ease-in-out infinite' : 'fadeIn 0.6s ease-out 0.3s both',
              boxShadow: purchaseBoth ? '0 0 25px rgba(34,197,94,0.2)' : '0 2px 12px rgba(0,0,0,0.2)',
            }}
          >
            {/* Glimmer sweep */}
            <div style={{
              position: 'absolute', top: 0, width: '60%', height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(34,197,94,0.08), rgba(255,255,255,0.06), transparent)',
              animation: 'glimmer 3s ease-in-out infinite',
              pointerEvents: 'none'
            }} />

            {/* Top badge */}
            <div style={{
              position: 'absolute', top: '-1px', left: '50%', transform: 'translateX(-50%)',
              background: 'linear-gradient(90deg, #22c55e, #10b981)',
              color: 'white', padding: '4px 18px', borderRadius: '0 0 10px 10px',
              fontSize: '11px', fontWeight: '800', letterSpacing: '0.5px',
              boxShadow: '0 4px 12px rgba(34,197,94,0.3)',
            }}>
              MEJOR OFERTA
            </div>

            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '14px'}}>
                {/* Radio */}
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                  border: purchaseBoth ? '3px solid #22c55e' : '3px solid rgba(255,255,255,0.2)',
                  background: purchaseBoth ? '#22c55e' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s',
                  boxShadow: purchaseBoth ? '0 0 12px rgba(34,197,94,0.4)' : 'none',
                }}>
                  {purchaseBoth && <span style={{color: 'white', fontSize: '14px', fontWeight: 'bold'}}>✓</span>}
                </div>
                {/* Overlapping album arts — bigger */}
                <div style={{display: 'flex', flexShrink: 0}}>
                  {songs.slice(0, 2).map((song, i) => (
                    <div key={song.id} style={{
                      width: '56px', height: '56px', borderRadius: '12px', overflow: 'hidden',
                      border: '3px solid #0f0b0e', marginLeft: i > 0 ? '-14px' : 0,
                      background: `linear-gradient(135deg, ${VERSION_VIBES[i]?.color || '#3b82f6'}30, rgba(225,29,116,0.2))`,
                      boxShadow: `0 4px 12px ${VERSION_VIBES[i]?.color || '#3b82f6'}25`,
                    }}>
                      {(() => {
                        const genreKey = song.genre || formData?.genre;
                        const imgSrc = genreKey ? `/images/album-art/${genreKey}.jpg` : song.imageUrl;
                        return imgSrc ? <img src={imgSrc} alt="" style={{width: '100%', height: '100%', objectFit: 'cover'}} onError={(e) => { e.target.style.display = 'none'; }} /> : null;
                      })()}
                    </div>
                  ))}
                </div>
                <div>
                  <p style={{margin: 0, fontSize: '17px', fontWeight: '800', color: purchaseBoth ? '#22c55e' : 'white'}}>
                    🎁 Ambas Versiones
                  </p>
                  <p style={{margin: '2px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.5)'}}>
                    🎵 Versión 1 + 🎶 Versión 2
                  </p>
                </div>
              </div>
              <div style={{textAlign: 'right', flexShrink: 0}}>
                <p style={{margin: 0, color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through', fontSize: '13px'}}>
                  ${(baseSinglePrice * 2).toFixed(2)}
                </p>
                <p style={{margin: 0, fontSize: '28px', fontWeight: '900', color: hasDiscount ? '#4ade80' : (purchaseBoth ? '#22c55e' : '#f74da6'), lineHeight: 1}}>
                  {isFree ? '¡GRATIS!' : `$${bundlePrice.toFixed(2)}`}
                </p>
                {hasDiscount && (
                  <p style={{margin: '2px 0 0', fontSize: '11px', color: '#4ade80', fontWeight: '700'}}>
                    🏷️ {discountPercent}% OFF aplicado
                  </p>
                )}
                <span style={{
                  fontSize: '11px', fontWeight: '700', color: '#22c55e',
                  background: 'rgba(34,197,94,0.15)', padding: '2px 10px',
                  borderRadius: '6px', display: 'inline-block', marginTop: '4px'
                }}>
                  Ahorras ${bundleSavings.toFixed(0)}
                </span>
              </div>
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════════════════════
            SECTION 4: Video Addon — Enhanced toggle
            ══════════════════════════════════════════════════════ */}
        <div ref={videoAddonRef} />
        {hasSelection && (
          <div
            onClick={() => setVideoAddon(!videoAddon)}
            style={{
              background: videoAddon
                ? 'linear-gradient(135deg, rgba(109,40,217,0.18), rgba(139,92,246,0.08))'
                : 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(255,255,255,0.02))',
              border: videoAddon ? '2px solid #8b5cf6' : '2px solid rgba(139,92,246,0.25)',
              borderRadius: '18px', padding: '20px',
              cursor: 'pointer', marginBottom: '16px',
              position: 'relative', overflow: 'hidden',
              transition: 'all 0.3s',
              animation: videoAddon ? 'videoBorderGlow 2.5s ease-in-out infinite' : 'fadeIn 0.4s ease-out',
              boxShadow: videoAddon ? '0 0 25px rgba(139,92,246,0.2)' : '0 2px 12px rgba(0,0,0,0.2)',
            }}
          >
            {/* Glimmer sweep */}
            <div style={{
              position: 'absolute', top: 0, width: '60%', height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.06), rgba(255,255,255,0.05), transparent)',
              animation: 'glimmer 3.5s ease-in-out infinite',
              pointerEvents: 'none'
            }} />

            {/* Social proof badge */}
            <div style={{
              position: 'absolute', top: '-1px', left: '50%', transform: 'translateX(-50%)',
              background: 'linear-gradient(90deg, #7c3aed, #a855f7)',
              color: 'white', padding: '4px 16px', borderRadius: '0 0 10px 10px',
              fontSize: '11px', fontWeight: '800', letterSpacing: '0.3px',
              boxShadow: '0 4px 12px rgba(124,58,237,0.3)',
            }}>
              87% LO AGREGAN
            </div>

            {/* Header with toggle */}
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', marginBottom: '12px'}}>
              <h3 style={{fontSize: '17px', fontWeight: '800', margin: 0, color: '#e9d5ff'}}>
                🎬 Video para {recipientName}
              </h3>
              {/* Toggle indicator */}
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                border: videoAddon ? '3px solid #22c55e' : '3px solid rgba(255,255,255,0.2)',
                background: videoAddon ? '#22c55e' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
                boxShadow: videoAddon ? '0 0 12px rgba(34,197,94,0.4)' : 'none',
              }}>
                {videoAddon && <span style={{color: 'white', fontSize: '14px', fontWeight: 'bold'}}>✓</span>}
              </div>
            </div>

            {/* Cinematic video preview — Ken Burns slideshow */}
            <div style={{
              position: 'relative', borderRadius: '14px', overflow: 'hidden',
              marginBottom: '14px', aspectRatio: '16/9',
              border: '2px solid rgba(139,92,246,0.3)',
              boxShadow: '0 8px 32px rgba(124,58,237,0.25)',
              background: '#0a0015',
            }}>
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

              {/* Gradient overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(180deg, rgba(10,0,21,0) 50%, rgba(10,0,21,0.7) 100%)',
                pointerEvents: 'none',
              }} />

              {/* Floating music notes */}
              <div style={{ position: 'absolute', top: '10px', right: '12px', display: 'flex', gap: '6px' }}>
                {['🎵', '🎶'].map((n, i) => (
                  <span key={i} style={{
                    fontSize: '16px', opacity: 0.7,
                    animation: `noteFloat 2s ease-in-out ${i * 0.7}s infinite`,
                  }}>{n}</span>
                ))}
              </div>

              {/* Play button overlay */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                width: '48px', height: '48px', borderRadius: '50%',
                background: 'rgba(124,58,237,0.85)', backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 20px rgba(124,58,237,0.5)',
              }}>
                <span style={{ fontSize: '18px', marginLeft: '3px', color: 'white' }}>▶</span>
              </div>

              {/* Bottom info bar */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'linear-gradient(180deg, transparent, rgba(10,0,21,0.9))',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: '#c4b5fd', fontWeight: 700 }}>Vista previa</span>
                  <span style={{ fontSize: '10px', color: 'rgba(196,181,253,0.6)' }}>•</span>
                  <span style={{ fontSize: '10px', color: 'rgba(196,181,253,0.6)' }}>Tus fotos + su canción</span>
                </div>
                <span style={{ fontSize: '10px', color: '#a78bfa', fontWeight: 600, background: 'rgba(124,58,237,0.3)', padding: '2px 7px', borderRadius: '5px' }}>HD 1080p</span>
              </div>

              {/* Progress bar */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'rgba(124,58,237,0.2)' }}>
                <div style={{ height: '100%', background: 'linear-gradient(90deg, #7c3aed, #a78bfa)', animation: 'progressPreview 28s linear infinite' }} />
              </div>
            </div>

            {/* Price + details */}
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap'}}>
              <span style={{fontSize: '14px', color: 'rgba(255,255,255,0.3)', textDecoration: 'line-through'}}>$29.99</span>
              <span style={{fontSize: '22px', fontWeight: '900', color: '#a855f7'}}>$9.99</span>
              <span style={{fontSize: '11px', fontWeight: '700', color: '#22c55e', background: 'rgba(34,197,94,0.15)', padding: '3px 10px', borderRadius: '8px'}}>Ahorra 67%</span>
            </div>
            <p style={{fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: '0 0 8px', lineHeight: 1.5}}>
              Video HD con tus fotos favoritas + graba un mensaje personal
            </p>
            {/* Mini feature pills */}
            <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
              {['HD 1080p', 'MP4', '🎤 Mensaje gratis'].map((f, i) => (
                <span key={i} style={{
                  fontSize: '10px', color: i === 2 ? '#ec4899' : 'rgba(255,255,255,0.6)',
                  background: i === 2 ? 'rgba(236,72,153,0.1)' : 'rgba(139,92,246,0.1)',
                  padding: '3px 8px', borderRadius: '6px',
                  border: i === 2 ? '1px solid rgba(236,72,153,0.2)' : '1px solid rgba(139,92,246,0.12)',
                  fontWeight: i === 2 ? '700' : '500'
                }}>{f}</span>
              ))}
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════════════════════
            SECTION 5: WhatsApp Phone Input
            ══════════════════════════════════════════════════════ */}
        <div style={{
          background: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.2)',
          borderRadius: '14px', padding: '14px 16px', marginBottom: '16px',
          animation: 'fadeIn 0.6s ease-out 0.4s both'
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px'}}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '6px',
              background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <p style={{margin: 0, fontSize: '14px', fontWeight: '600', color: 'white', flex: 1}}>
              Recibe por WhatsApp y Número de Teléfono
            </p>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <input
              type="tel"
              value={whatsappPhone}
              onChange={(e) => { setWhatsappPhone(e.target.value.replace(/[^\d\s\-\+\(\)]/g, '')); }}
              placeholder="Tu número de teléfono"
              maxLength={20}
              style={{
                flex: 1, padding: '12px 14px',
                background: 'rgba(255,255,255,0.08)', border: whatsappPhone.replace(/\D/g, '').length >= 10 ? '1.5px solid #25D366' : '1.5px solid rgba(255,255,255,0.1)',
                borderRadius: '10px', color: 'white', fontSize: '15px', outline: 'none', transition: 'border-color 0.3s'
              }}
            />
            {whatsappPhone.replace(/\D/g, '').length >= 10 && (
              <div style={{width: '32px', height: '32px', borderRadius: '50%', background: '#25D366',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
                <span style={{color: 'white', fontSize: '16px', fontWeight: 'bold'}}>✓</span>
              </div>
            )}
          </div>
          <p style={{margin: '8px 0 0', color: 'rgba(255,255,255,0.3)', fontSize: '10px', lineHeight: 1.5}}>
            Al proporcionar tu número aceptas mensajes transaccionales. <a href="/politica-de-privacidad" target="_blank" rel="noopener noreferrer" style={{color: '#25D366', textDecoration: 'underline'}}>Privacidad</a> · <a href="/terminos-de-servicio" target="_blank" rel="noopener noreferrer" style={{color: '#25D366', textDecoration: 'underline'}}>Términos</a>
          </p>
        </div>


        {/* ══════════════════════════════════════════════════════
            SECTION 6: Checkout — CTA + Trust
            ══════════════════════════════════════════════════════ */}
        <div style={{animation: 'fadeIn 0.6s ease-out 0.5s both'}}>
          {/* Discount applied banner */}
          {hasDiscount && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '10px 16px', marginBottom: '12px',
              background: 'rgba(74,222,128,0.1)', borderRadius: '10px',
              border: '1px solid rgba(74,222,128,0.3)'
            }}>
              <span style={{fontSize: '16px'}}>🏷️</span>
              <span style={{color: '#4ade80', fontSize: '14px', fontWeight: '700'}}>
                ¡Descuento del {discountPercent}% aplicado!
              </span>
              <span style={{color: 'rgba(255,255,255,0.5)', fontSize: '12px'}}>
                Código: {couponApplied?.code}
              </span>
            </div>
          )}
          {/* Selection summary line */}
          {hasSelection && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', marginBottom: '12px',
              background: 'rgba(242,13,128,0.08)', borderRadius: '10px',
              border: '1px solid rgba(242,13,128,0.15)'
            }}>
              <p style={{margin: 0, fontSize: '14px', color: 'rgba(255,255,255,0.8)'}}>
                {getSelectionLabel()}
                {hasDiscount && <span style={{color: '#4ade80', fontSize: '12px', marginLeft: '8px'}}>🏷️ {discountPercent}% OFF</span>}
              </p>
              <div style={{textAlign: 'right'}}>
                {hasDiscount && (
                  <p style={{margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through'}}>
                    ${(videoAddon ? (purchaseBoth ? baseBundlePrice : baseSinglePrice) + videoAddonPrice : (purchaseBoth ? baseBundlePrice : baseSinglePrice)).toFixed(2)}
                  </p>
                )}
                <p style={{margin: 0, fontSize: '20px', fontWeight: '800', color: hasDiscount ? '#4ade80' : '#f74da6'}}>
                  {isFree ? '¡GRATIS!' : `$${getCurrentPrice().toFixed(2)}`}
                </p>
              </div>
            </div>
          )}

          {/* Main CTA */}
          <button
            ref={checkoutCtaRef}
            onClick={handleCheckout}
            disabled={isCheckingOut || !hasSelection}
            style={{
              width: '100%', padding: '18px',
              background: hasSelection ? 'linear-gradient(90deg, #e11d74, #c026d3)' : 'rgba(255,255,255,0.06)',
              color: hasSelection ? 'white' : 'rgba(255,255,255,0.25)',
              border: 'none', borderRadius: '12px',
              fontSize: '18px', fontWeight: 'bold',
              cursor: hasSelection ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s',
              boxShadow: hasSelection ? '0 4px 20px rgba(225,29,116,0.4)' : 'none'
            }}
          >
            {isCheckingOut ? '⏳ Procesando...'
              : !hasSelection ? '👆 Selecciona una opción'
              : isFree ? '🎉 Descargar Gratis'
              : `💳 ${purchaseBoth ? 'Comprar Ambas' : 'Comprar Canción'}${videoAddon ? ' + Video' : ''} — $${getCurrentPrice().toFixed(2)}`
            }
          </button>

          {/* Trust line */}
          <div style={{display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '14px', flexWrap: 'wrap'}}>
            {['🔒 Pago seguro', '⚡ Entrega instantánea', '🎵 Preview 35s · Canción ~3 min'].map((t, i) => (
              <span key={i} style={{color: 'rgba(255,255,255,0.35)', fontSize: '11px'}}>{t}</span>
            ))}
          </div>

          {/* Sales final disclaimer */}
          <p style={{textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '10px', marginTop: '10px', lineHeight: 1.5}}>
            Todas las ventas son finales. Escucha la vista previa antes de comprar.
          </p>
        </div>

        {/* Footer */}
        <p style={{textAlign: 'center', marginTop: '40px', color: 'rgba(255,255,255,0.2)', fontSize: '11px'}}>
          RegalosQueCantan © {new Date().getFullYear()}
        </p>

        {/* Exit Intent Popup */}
        <ExitIntentPopup
          couponApplied={couponApplied}
          selectedSongs={songs}
          purchaseBoth={purchaseBoth}
          onApplyCoupon={(couponData) => {
            setCouponCode(couponData.code);
            setCouponApplied(couponData);
          }}
          onClose={() => {}}
        />

        {/* Song 2 Ready Toast */}
        {song2Ready && (
          <div style={{
            position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)',
            background: '#7c3aed', color: 'white', padding: '12px 24px', borderRadius: '50px',
            fontSize: '14px', fontWeight: 'bold', boxShadow: '0 6px 24px rgba(124,58,237,0.5)',
            zIndex: 100, display: 'flex', alignItems: 'center', gap: '6px',
            animation: 'toastIn 3.5s ease-in-out forwards'
          }}>
            ✨ ¡Versión 2 lista!
          </div>
        )}
      </div>
    </div>
  );
}
