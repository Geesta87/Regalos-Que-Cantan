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
  const singlePrice = 24.99;
  const bundlePrice = 39.99;
  const videoAddonPrice = 9.99;
  const bundleSavings = (singlePrice * 2) - bundlePrice;
  const isFree = couponApplied?.free || false;

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
    trackStep('song_selected', { value: 24.99, content_ids: [songId], num_items: 1 });
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
    <div style={{background: 'linear-gradient(160deg, #110d0f 0%, #181114 40%, #1e1519 70%, #151015 100%)', color: 'white', minHeight: '100vh', padding: '20px', overflow: 'hidden'}}>
      
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
          0%, 100% { box-shadow: 0 0 25px rgba(242,13,128,0.4), 0 0 50px rgba(242,13,128,0.15); }
          50% { box-shadow: 0 0 40px rgba(242,13,128,0.6), 0 0 80px rgba(242,13,128,0.25); }
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
        @keyframes vBannerPulse {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes vCountBounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes btnPulse {
          0%, 100% { box-shadow: 0 4px 18px var(--pulse-color, rgba(59,130,246,0.4)); }
          50% { box-shadow: 0 6px 28px var(--pulse-color, rgba(59,130,246,0.6)); }
        }
      `}</style>

      {/* Audio elements */}
      {songs.map(song => (
        <audio
          key={song.id}
          ref={el => audioRefs.current[song.id] = el}
          src={song.audioUrl || song.previewUrl}
          preload="auto"
          onLoadedMetadata={(e) => { if (e.target) e.target.currentTime = PREVIEW_START; }}
          onCanPlay={() => {
            // Only count first canplay per audio element to avoid resetting autoplay timer
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
        maxWidth: '900px', 
        margin: '0 auto', 
        paddingTop: '30px',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>

        {/* ===== INSTANT DELIVERY BANNER ===== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(242,13,128,0.2), rgba(242,13,128,0.1))',
          borderRadius: '16px',
          padding: '14px 20px',
          marginBottom: '20px',
          textAlign: 'center',
          border: '1px solid rgba(242,13,128,0.3)'
        }}>
          <div style={{ fontSize: '15px', fontWeight: '800', letterSpacing: '0.5px', color: '#f20d80' }}>
            ⚡ +500 canciones creadas · Entrega instantánea
          </div>
        </div>
        
        {/* ===== REC 3: Personalized emotional banner ===== */}
        <div style={{textAlign: 'center', marginBottom: '30px'}}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(242,13,128,0.2), rgba(225,29,116,0.15), rgba(139,92,246,0.1))',
            borderRadius: '16px',
            padding: '24px 28px',
            marginBottom: '20px',
            border: '1px solid rgba(242,13,128,0.3)',
            boxShadow: '0 4px 30px rgba(242,13,128,0.1), inset 0 1px 0 rgba(255,255,255,0.05)'
          }}>
            <p style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.7)',
              margin: '0 0 6px 0',
              letterSpacing: '2.5px',
              textTransform: 'uppercase'
            }}>
              Hecho con ❤️ exclusivamente para
            </p>
            <h2 style={{
              fontSize: '32px',
              fontWeight: 'bold',
              margin: '0 0 8px 0',
              background: 'linear-gradient(90deg, #f20d80, #f74da6, #f20d80)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'shimmer 3s linear infinite'
            }}>
              {recipientName}
            </h2>
            <p style={{
              fontSize: '14px',
              color: 'rgba(255,255,255,0.6)',
              margin: 0,
              fontStyle: 'italic'
            }}>
              Una canción que nunca antes ha existido — creada solo para {recipientName}
            </p>
          </div>

          <h1 style={{fontSize: '24px', marginBottom: '6px', fontWeight: 'bold'}}>
            🎵 Elige tu versión favorita
          </h1>
          <p style={{color: 'rgba(255,255,255,0.7)', fontSize: '15px', margin: 0}}>
            {songs.length} {songs.length === 1 ? 'versión' : 'versiones'}
            {song2Loading && ' • Versión 2 en camino...'}
            {' • '}<span style={{color: '#f74da6', fontWeight: '600'}}>{genreName}</span>
          </p>
          <p style={{color: 'rgba(255,255,255,0.45)', fontSize: '12px', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center'}}>
            🎧 Estos son previews de 35 segundos · Tu canción completa dura ~3-4 minutos
          </p>
          
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

        {/* ===== AUTO-PLAY BLOCKED BANNER ===== */}
        {autoPlayBlocked && !playingId && (
          <div style={{
            marginBottom: '20px',
            animation: 'fadeInUp 0.5s ease-out',
          }}>
            <div style={{
              background: 'linear-gradient(135deg, rgba(242,13,128,0.12), rgba(139,92,246,0.12))',
              border: '1.5px solid rgba(242,13,128,0.25)',
              borderRadius: '16px', padding: '18px 20px',
              textAlign: 'center',
            }}>
              <p style={{
                fontSize: '18px', fontWeight: '800', margin: '0 0 6px',
                color: '#f74da6',
              }}>
                👇 Toca el botón para escuchar tu canción
              </p>
              <p style={{
                fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: '0 0 4px',
              }}>
                🔊 Asegúrate de tener el volumen arriba
              </p>
            </div>
          </div>
        )}

        {/* ===== REC 6: Social proof strip ===== */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '16px',
          marginBottom: '28px',
          flexWrap: 'wrap',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.2s both' : 'none'
        }}>
          {[
            { icon: '🔥', text: '147 canciones', sub: 'creadas hoy' },
            { icon: '⭐', text: '4.9/5', sub: 'satisfacción' },
            { icon: '🎁', text: 'Ideal para', sub: 'Cualquier Ocasión' }
          ].map((item, i) => (
            <span key={i} style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.6)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              {item.icon} <span style={{color: '#f74da6', fontWeight: '600'}}>{item.text}</span> {item.sub}
            </span>
          ))}
        </div>

        {/* ===== REC 2, 4, 5: Song Cards ===== */}
        <div style={{
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
          gap: '20px', 
          marginBottom: '20px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.3s both' : 'none'
        }}>
          {songs.map((song, index) => {
            const isSelected = selectedSongId === song.id;
            const isOtherSelected = (selectedSongId && !isSelected) || purchaseBoth;
            const isPlaying = playingId === song.id;
            const isAutoHighlight = autoPlayingIndex === index; // ✅ Card being auto-played
            const vibe = VERSION_VIBES[index] || VERSION_VIBES[0];
            const lyricsPreview = getLyricsPreview(song.lyrics);
            const isExpanded = expandedLyrics[song.id];
            
            return (
              <div
                key={song.id}
                onClick={() => selectSong(song.id)}
                style={{
                  background: (isSelected || isAutoHighlight)
                    ? `linear-gradient(135deg, ${vibe.color}30, ${vibe.color}15)` 
                    : 'linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))',
                  border: (isSelected || isAutoHighlight)
                    ? `3px solid ${isSelected ? '#f74da6' : vibe.color}` 
                    : `2px solid ${vibe.color}35`,
                  borderRadius: '20px',
                  padding: '24px',
                  cursor: 'pointer',
                  transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
                  opacity: isOtherSelected ? 0.55 : 1,
                  transform: (isSelected || isAutoHighlight) ? 'scale(1.02)' : 'scale(1)',
                  boxShadow: isSelected 
                    ? '0 0 35px rgba(242,13,128,0.4), 0 8px 32px rgba(0,0,0,0.4)' 
                    : isAutoHighlight 
                      ? `0 0 30px ${vibe.color}50, 0 8px 32px rgba(0,0,0,0.4)` 
                      : '0 4px 24px rgba(0,0,0,0.3)',
                  position: 'relative',
                  backdropFilter: 'blur(10px)',
                  animation: (song.version === 2 && song2Ready) ? 'song2Reveal 0.6s cubic-bezier(0.16, 1, 0.3, 1)' : undefined
                }}
              >
                {/* Radio indicator */}
                <div style={{
                  position: 'absolute', top: '15px', right: '15px',
                  width: '28px', height: '28px', borderRadius: '50%',
                  border: isSelected ? '3px solid #f20d80' : '3px solid rgba(255,255,255,0.3)',
                  background: isSelected ? '#f20d80' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s', zIndex: 2
                }}>
                  {isSelected && <span style={{color: '#181114', fontSize: '16px', fontWeight: 'bold'}}>✓</span>}
                </div>

                {/* REC 5: Version badge with personality */}
                <div style={{marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px'}}>
                  <span style={{
                    background: vibe.gradient, 
                    padding: '7px 16px', 
                    borderRadius: '20px', 
                    fontSize: '13px', 
                    fontWeight: 'bold',
                    boxShadow: `0 3px 12px ${vibe.color}50`,
                    letterSpacing: '0.3px'
                  }}>
                    {vibe.emoji} Versión {index + 1}
                  </span>
                  <span style={{fontSize: '13px', color: vibe.color, fontWeight: '700', letterSpacing: '0.5px'}}>
                    {vibe.label}
                  </span>
                </div>

                {/* REC 2: Bigger album art with glow */}
                <div style={{
                  height: '280px',
                  borderRadius: '14px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  marginBottom: '18px',
                  overflow: 'hidden',
                  position: 'relative',
                  animation: isPlaying ? 'glow 2s ease-in-out infinite' : 'none',
                  background: `linear-gradient(135deg, ${vibe.color}40, rgba(225,29,116,0.25))`,
                  boxShadow: `0 8px 30px ${vibe.color}25`,
                  border: `2px solid ${vibe.color}50`
                }}>
                  {(() => {
                    const genreKey = song.genre || formData?.genre;
                    const staticImg = getGenreImagePath(genreKey);
                    const imgSrc = staticImg || song.imageUrl;
                    return imgSrc ? (
                      <img
                        src={imgSrc}
                        alt=""
                        style={{
                          width: '100%', height: '100%', objectFit: 'cover',
                          transition: 'transform 0.5s',
                          transform: isPlaying ? 'scale(1.05)' : 'scale(1)'
                        }}
                        onError={(e) => {
                          // Try Pollinations URL as second fallback if static failed
                          if (song.imageUrl && e.target.src !== song.imageUrl) {
                            e.target.src = song.imageUrl;
                          } else {
                            e.target.style.display = 'none';
                            e.target.parentElement.innerHTML = '<span style="font-size:72px">🎵</span>';
                          }
                        }}
                      />
                    ) : (
                      <span style={{fontSize: '72px'}}>🎵</span>
                    );
                  })()}
                  
                  {/* Shine sweep effect */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 55%, transparent 60%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 4s ease-in-out infinite',
                    pointerEvents: 'none'
                  }} />
                  
                  {/* Playing overlay with equalizer */}
                  {isPlaying && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      padding: '12px',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                      gap: '3px', height: '50px'
                    }}>
                      {[0.6, 0.5, 0.7, 0.8, 0.4].map((dur, i) => (
                        <div key={i} style={{
                          width: '4px', background: '#f20d80', borderRadius: '2px',
                          animation: `eq${(i % 3) + 1} ${dur}s ease-in-out infinite`
                        }} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Song info */}
                <h3 style={{fontSize: '18px', marginBottom: '4px', fontWeight: 'bold'}}>
                  Para {recipientName}
                </h3>
                <p style={{color: '#f74da6', fontSize: '13px', marginBottom: '12px', fontWeight: '500'}}>{genreName}</p>

                {/* REC 4: Lyrics preview snippet */}
                {lyricsPreview.length > 0 && (
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedLyrics(prev => ({...prev, [song.id]: !prev[song.id]}));
                    }}
                    style={{
                      background: `rgba(255,255,255,0.09)`,
                      borderRadius: '10px',
                      padding: '12px 14px',
                      marginBottom: '15px',
                      borderLeft: `3px solid ${vibe.color}`,
                      cursor: 'pointer'
                    }}
                  >
                    <p style={{
                      fontSize: '11px', color: 'rgba(255,255,255,0.7)',
                      margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '1px'
                    }}>
                      📝 Vista previa de la letra
                    </p>
                    {lyricsPreview.slice(0, isExpanded ? 10 : 4).map((line, i) => (
                      <p key={i} style={{
                        fontSize: '13px', color: 'rgba(255,255,255,0.9)',
                        margin: i < (isExpanded ? 9 : 3) ? '0 0 3px 0' : 0,
                        fontStyle: 'italic', lineHeight: '1.4'
                      }}>
                        "{line}"
                      </p>
                    ))}
                    {lyricsPreview.length > 4 && (
                      <p style={{fontSize: '11px', color: vibe.color, margin: '6px 0 0 0'}}>
                        {isExpanded ? '▲ Ver menos' : '▼ Ver más letra...'}
                      </p>
                    )}
                  </div>
                )}

                {/* Play button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handlePlay(song.id); }}
                  style={{
                    width: '100%', padding: '16px',
                    background: isPlaying 
                      ? 'linear-gradient(90deg, #f74da6, #f20d80)' 
                      : vibe.gradient,
                    color: isPlaying ? '#181114' : 'white',
                    border: 'none', borderRadius: '12px',
                    cursor: 'pointer', fontWeight: 'bold', fontSize: '15px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    transition: 'all 0.3s',
                    boxShadow: isPlaying ? '0 4px 20px rgba(242,13,128,0.5)' : `0 4px 18px ${vibe.color}40`,
                    animation: !isPlaying && !previewEnded[song.id] ? 'btnPulse 2s ease-in-out infinite' : 'none',
                    '--pulse-color': `${vibe.color}50`
                  }}
                >
                  {isPlaying ? '⏸ Pausar' : '▶ Escuchar Canción'}
                </button>

                {/* Progress bar */}
                <div style={{marginTop: '12px', height: '6px', background: 'rgba(255,255,255,0.12)', borderRadius: '3px', overflow: 'hidden'}}>
                  <div style={{
                    height: '100%', 
                    background: isPlaying ? 'linear-gradient(90deg, #f20d80, #f74da6)' : vibe.color, 
                    borderRadius: '3px', 
                    width: `${((currentTimes[song.id] || 0) / PREVIEW_DURATION) * 100}%`, 
                    transition: 'width 0.1s'
                  }} />
                </div>
                <p style={{fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '6px', textAlign: 'right'}}>
                  {formatTime(currentTimes[song.id] || 0)} / {formatTime(PREVIEW_DURATION)}
                </p>

                {/* Price */}
                <div style={{
                  marginTop: '12px', paddingTop: '15px',
                  borderTop: `1px solid ${vibe.color}30`,
                  textAlign: 'center'
                }}>
                  <div style={{ textAlign: 'center', marginBottom: '4px' }}>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                      Pago único · Para siempre
                    </p>
                  </div>
                  <span style={{fontSize: '32px', fontWeight: '800', color: isSelected ? '#f74da6' : 'white'}}>
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

        {/* ===== REC 7: Upgraded bundle deal ===== */}
        {songs.length >= 2 && (
          <>
            {/* OR Divider */}
            <div style={{
              display: 'flex', alignItems: 'center', margin: '30px 0', gap: '20px',
              animation: isVisible ? 'fadeInUp 0.8s ease-out 0.5s both' : 'none'
            }}>
              <div style={{flex: 1, height: '2px', background: 'linear-gradient(90deg, transparent, rgba(242,13,128,0.5))'}} />
              <span style={{
                color: '#f74da6', fontSize: '16px', fontWeight: 'bold',
                padding: '8px 20px', background: 'rgba(242,13,128,0.15)',
                borderRadius: '20px', border: '1px solid rgba(242,13,128,0.4)'
              }}>
                O MEJOR AÚN
              </span>
              <div style={{flex: 1, height: '2px', background: 'linear-gradient(90deg, rgba(242,13,128,0.5), transparent)'}} />
            </div>

            {/* Bundle card */}
            <div
              onClick={selectBoth}
              style={{
                background: purchaseBoth 
                  ? 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(242,13,128,0.15))' 
                  : 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))',
                border: purchaseBoth ? '3px solid #22c55e' : '2px solid rgba(255,255,255,0.18)',
                borderRadius: '20px', padding: '30px 25px',
                cursor: 'pointer', marginBottom: '30px',
                position: 'relative', transition: 'all 0.3s',
                transform: purchaseBoth ? 'scale(1.01)' : 'scale(1)',
                boxShadow: purchaseBoth ? '0 0 30px rgba(34,197,94,0.2)' : 'none',
                opacity: selectedSongId ? 0.6 : 1,
                animation: isVisible ? 'fadeInUp 0.8s ease-out 0.6s both' : 'none'
              }}
            >
              {/* Ribbon badge */}
              <div style={{
                position: 'absolute', top: '-14px', left: '50%',
                transform: 'translateX(-50%)',
                background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                color: 'white', padding: '8px 24px', borderRadius: '20px',
                fontSize: '13px', fontWeight: 'bold',
                boxShadow: '0 4px 15px rgba(34,197,94,0.4)',
                animation: 'ribbonFloat 3s ease-in-out infinite',
                whiteSpace: 'nowrap'
              }}>
                🎁 2 CANCIONES POR SOLO ${bundlePrice}
              </div>

              {/* Radio indicator */}
              <div style={{
                position: 'absolute', top: '20px', right: '20px',
                width: '28px', height: '28px', borderRadius: '50%',
                border: purchaseBoth ? '3px solid #22c55e' : '3px solid rgba(255,255,255,0.3)',
                background: purchaseBoth ? '#22c55e' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s'
              }}>
                {purchaseBoth && <span style={{color: 'white', fontSize: '16px', fontWeight: 'bold'}}>✓</span>}
              </div>

              {/* Bundle content with overlapping album arts */}
              <div style={{marginTop: '10px'}}>
                <div style={{
                  display: 'flex', justifyContent: 'center', gap: '0px', marginBottom: '18px'
                }}>
                  {songs.slice(0, 2).map((song, i) => (
                    <div key={song.id} style={{
                      width: '110px', height: '110px', borderRadius: '14px',
                      overflow: 'hidden', border: '3px solid #181114',
                      marginLeft: i > 0 ? '-20px' : 0,
                      position: 'relative', zIndex: songs.length - i,
                      background: `linear-gradient(135deg, ${VERSION_VIBES[i]?.color || '#3b82f6'}30, rgba(225,29,116,0.2))`,
                      boxShadow: `0 6px 20px ${VERSION_VIBES[i]?.color || '#3b82f6'}30`,
                      transition: 'transform 0.3s',
                    }}>
                      {(() => {
                        const genreKey = song.genre || formData?.genre;
                        const staticImg = genreKey ? `/images/album-art/${genreKey}.jpg` : null;
                        const imgSrc = staticImg || song.imageUrl;
                        return imgSrc ? (
                          <img
                            src={imgSrc} alt=""
                            style={{width: '100%', height: '100%', objectFit: 'cover'}}
                            onError={(e) => {
                              if (song.imageUrl && e.target.src !== song.imageUrl) {
                                e.target.src = song.imageUrl;
                              } else {
                                e.target.style.display = 'none';
                                e.target.parentElement.innerHTML = '<span style="font-size:42px;display:flex;align-items:center;justify-content:center;height:100%">🎵</span>';
                              }
                            }}
                          />
                        ) : (
                          <span style={{fontSize: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>🎵</span>
                        );
                      })()}
                    </div>
                  ))}
                </div>

                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', flexWrap: 'wrap', gap: '20px'
                }}>
                  <div>
                    <h3 style={{fontSize: '20px', marginBottom: '8px', fontWeight: 'bold'}}>
                      🎁 ¡Llévate AMBAS versiones!
                    </h3>
                    <p style={{color: 'rgba(255,255,255,0.75)', fontSize: '14px', margin: '0 0 4px 0'}}>
                      Regala 2 versiones — deja que {recipientName} elija su favorita
                    </p>
                    <p style={{color: 'rgba(255,255,255,0.55)', fontSize: '13px', margin: 0}}>
                      💫 Emotiva + 🔥 Enérgica • Descarga instantánea
                    </p>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <p style={{color: 'rgba(255,255,255,0.45)', textDecoration: 'line-through', fontSize: '16px', margin: '0 0 5px 0'}}>
                      ${(singlePrice * 2).toFixed(2)}
                    </p>
                    <p style={{
                      color: purchaseBoth ? '#22c55e' : '#f74da6', 
                      fontSize: '36px', fontWeight: 'bold', margin: 0, lineHeight: 1
                    }}>
                      ${bundlePrice}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ===== VIDEO ADD-ON CARD ===== */}
        <div ref={videoAddonRef} />
        {hasSelection && (
          <>
            <style>{`
              @keyframes kbSlide1 { 0%{transform:scale(1) translate(0,0);opacity:1} 20%{transform:scale(1.12) translate(-2%,1%);opacity:1} 25%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide2 { 0%{opacity:0} 20%{opacity:0} 25%{transform:scale(1.08) translate(2%,-1%);opacity:1} 45%{transform:scale(1.2) translate(-1%,2%);opacity:1} 50%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide3 { 0%{opacity:0} 45%{opacity:0} 50%{transform:scale(1) translate(-1%,0);opacity:1} 70%{transform:scale(1.15) translate(2%,-2%);opacity:1} 75%{opacity:0} 100%{opacity:0} }
              @keyframes kbSlide4 { 0%{opacity:0} 70%{opacity:0} 75%{transform:scale(1.05) translate(0,1%);opacity:1} 95%{transform:scale(1.18) translate(-3%,2%);opacity:1} 100%{opacity:0} }
              @keyframes videoProgress { 0%{width:0%} 100%{width:100%} }
              @keyframes softPulse { 0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,0.3)} 50%{box-shadow:0 0 0 8px rgba(139,92,246,0)} }
            `}</style>

            {/* Social proof */}
            <div style={{
              textAlign: 'center', margin: '8px 0 12px',
              animation: 'fadeInUp 0.5s ease-out',
            }}>
              <span style={{
                fontSize: '13px', color: '#c4b5fd', fontWeight: '600',
                background: 'rgba(139,92,246,0.1)', padding: '6px 16px',
                borderRadius: '20px', border: '1px solid rgba(139,92,246,0.15)',
              }}>
                🎬 87% de clientes agregan el video
              </span>
            </div>

            <div
              onClick={() => setVideoAddon(!videoAddon)}
              style={{
                background: videoAddon
                  ? 'linear-gradient(160deg, rgba(109,40,217,0.25), rgba(79,70,229,0.15))'
                  : 'linear-gradient(160deg, rgba(109,40,217,0.08), rgba(0,0,0,0))',
                border: videoAddon ? '3px solid #8b5cf6' : '2px solid rgba(139,92,246,0.25)',
                borderRadius: '20px', padding: '0',
                cursor: 'pointer', marginBottom: '24px',
                transition: 'all 0.3s',
                overflow: 'hidden', position: 'relative',
                animation: videoAddon ? 'none' : 'softPulse 2.5s ease-in-out infinite',
                boxShadow: videoAddon ? '0 0 30px rgba(109,40,217,0.3)' : '0 4px 20px rgba(109,40,217,0.08)',
                transform: videoAddon ? 'scale(1.01)' : 'scale(1)',
              }}
            >
              {/* Checkmark indicator (same pattern as song cards) */}
              <div style={{
                position: 'absolute', top: '16px', right: '16px', zIndex: 3,
                width: '32px', height: '32px', borderRadius: '50%',
                border: videoAddon ? '3px solid #22c55e' : '3px solid rgba(255,255,255,0.3)',
                background: videoAddon ? '#22c55e' : 'rgba(0,0,0,0.4)',
                backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
                boxShadow: videoAddon ? '0 4px 15px rgba(34,197,94,0.4)' : 'none',
              }}>
                {videoAddon && <span style={{color: 'white', fontSize: '18px', fontWeight: 'bold'}}>✓</span>}
              </div>

              {/* Video Preview — Phone Mockup */}
              <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                padding: '24px 20px 16px',
                background: 'linear-gradient(180deg, rgba(124,58,237,0.08), rgba(0,0,0,0))',
                borderRadius: '18px 18px 0 0',
              }}>
                {/* Phone frame */}
                <div style={{
                  position: 'relative', width: '180px', height: '320px',
                  borderRadius: '28px', overflow: 'hidden',
                  border: '4px solid rgba(255,255,255,0.15)',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(124,58,237,0.15)',
                  background: '#000',
                }}>
                  {/* Notch */}
                  <div style={{
                    position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
                    width: '60px', height: '6px', borderRadius: '3px',
                    background: 'rgba(255,255,255,0.15)', zIndex: 3,
                  }} />

                  {/* Ken Burns slideshow */}
                  {[
                    '/images/reactions/reaction1.jpg',
                    '/images/reactions/reaction3.jpg',
                    '/images/reactions/reaction6.jpg',
                    '/images/reactions/reaction9.jpg',
                  ].map((src, i) => (
                    <img key={i} src={src} alt="" style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                      objectPosition: 'center 30%',
                      animation: `kbSlide${i + 1} 20s ease-in-out infinite`,
                      opacity: i === 0 ? 1 : 0,
                      filter: 'brightness(0.9)',
                    }} />
                  ))}

                  {/* Bottom gradient */}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px', background: 'linear-gradient(0deg, rgba(0,0,0,0.85), transparent)', pointerEvents: 'none' }} />

                  {/* Play button */}
                  <div style={{
                    position: 'absolute', top: '45%', left: '50%', transform: 'translate(-50%,-50%)',
                    width: '48px', height: '48px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid rgba(255,255,255,0.3)',
                  }}>
                    <span style={{ fontSize: '18px', marginLeft: '3px', color: 'white' }}>▶</span>
                  </div>

                  {/* Song info overlay */}
                  <div style={{ position: 'absolute', bottom: '28px', left: '10px', right: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {(() => {
                        const genreKey = songs[0]?.genre || formData?.genre;
                        const imgSrc = genreKey ? `/images/album-art/${genreKey}.jpg` : null;
                        return imgSrc ? (
                          <img src={imgSrc} alt="" style={{
                            width: '28px', height: '28px', borderRadius: '6px',
                            objectFit: 'cover', border: '1.5px solid rgba(255,255,255,0.3)',
                          }} />
                        ) : null;
                      })()}
                      <div>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: 'white', margin: 0, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                          Para {recipientName}
                        </p>
                        <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
                          Video con fotos
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ position: 'absolute', bottom: '10px', left: '10px', right: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>0:00</span>
                    <div style={{ flex: 1, height: '2px', borderRadius: '1px', background: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
                      <div style={{ width: '35%', height: '100%', background: 'white', animation: 'videoProgress 20s linear infinite' }} />
                    </div>
                    <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>3:24</span>
                  </div>
                </div>
              </div>

              {/* Content Section */}
              <div style={{padding: '18px 20px'}}>
                {/* Title + Price anchoring */}
                <div style={{ marginBottom: '12px' }}>
                  <h3 style={{fontSize: '18px', fontWeight: '800', margin: '0 0 4px', color: '#e9d5ff'}}>
                    🎬 Video para {recipientName}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.3)', textDecoration: 'line-through' }}>$29.99</span>
                    <span style={{ fontSize: '24px', fontWeight: '900', color: '#a855f7' }}>Solo ${videoAddonPrice}</span>
                    <span style={{
                      fontSize: '11px', fontWeight: 'bold', color: '#22c55e',
                      background: 'rgba(34,197,94,0.15)', padding: '3px 10px',
                      borderRadius: '8px', border: '1px solid rgba(34,197,94,0.2)',
                    }}>
                      Ahorra 67%
                    </span>
                  </div>
                  <p style={{color: 'rgba(255,255,255,0.5)', fontSize: '13px', margin: 0, lineHeight: 1.5}}>
                    Sube tus fotos y creamos un video cinematográfico con la canción. También puedes grabar un mensaje personal de video para {recipientName} — ¡gratis y opcional!
                  </p>
                </div>

                {/* Before → After mini comparison */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px',
                  padding: '12px', borderRadius: '14px',
                  background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.12)',
                }}>
                  {/* Before: just MP3 */}
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      width: '48px', height: '48px', borderRadius: '12px', margin: '0 auto 6px',
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '22px',
                    }}>🎵</div>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Solo audio</p>
                  </div>

                  {/* Arrow */}
                  <div style={{ fontSize: '18px', color: '#7c3aed', fontWeight: '900' }}>→</div>

                  {/* After: cinematic video */}
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      width: '48px', height: '48px', borderRadius: '12px', margin: '0 auto 6px',
                      background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '22px',
                      boxShadow: '0 4px 15px rgba(124,58,237,0.3)',
                    }}>🎬</div>
                    <p style={{ fontSize: '11px', color: '#c4b5fd', margin: 0, fontWeight: '600' }}>Video + Audio</p>
                  </div>
                </div>

                {/* Feature tags */}
                <div style={{display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px'}}>
                  {[
                    'Efecto Ken Burns',
                    'Video HD 1080p',
                    'MP4 descargable',
                    'Tus fotos favoritas',
                    '🎤 Graba tu mensaje personal — ¡gratis!'
                  ].map((feat, i) => (
                    <span key={i} style={{
                      fontSize: '11px', color: i === 4 ? '#ec4899' : 'rgba(255,255,255,0.8)',
                      background: i === 4 ? 'rgba(236,72,153,0.1)' : 'rgba(139,92,246,0.1)', borderRadius: '8px',
                      padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px',
                      border: i === 4 ? '1px solid rgba(236,72,153,0.25)' : '1px solid rgba(139,92,246,0.15)',
                      fontWeight: i === 4 ? '700' : '400'
                    }}>
                      <span style={{color: '#a78bfa'}}>✓</span> {feat}
                    </span>
                  ))}
                </div>

                {/* CTA button or selected state */}
                <div style={{
                  width: '100%', padding: '14px', borderRadius: '14px',
                  textAlign: 'center', fontWeight: '800', fontSize: '15px',
                  transition: 'all 0.3s',
                  background: videoAddon
                    ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                    : 'linear-gradient(90deg, #7c3aed, #a855f7)',
                  color: 'white',
                  boxShadow: videoAddon
                    ? '0 4px 20px rgba(34,197,94,0.3)'
                    : '0 4px 20px rgba(124,58,237,0.3)',
                }}>
                  {videoAddon
                    ? '✓ Video agregado'
                    : `🎬 ¡Sí, quiero el video para ${recipientName}!`
                  }
                </div>

                {/* Urgency */}
                <p style={{
                  textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.4)',
                  margin: '10px 0 0', fontStyle: 'italic',
                }}>
                  Solo disponible al momento de la compra
                </p>
              </div>
            </div>
          </>
        )}

        {/* Selection Summary */}
        {hasSelection && (
          <div style={{
            background: 'rgba(242,13,128,0.15)',
            border: '2px solid #f74da6', borderRadius: '12px',
            padding: '15px 20px', marginBottom: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            animation: 'fadeInUp 0.4s ease-out'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <span style={{fontSize: '24px'}}>✓</span>
              <div>
                <p style={{margin: 0, fontWeight: 'bold', color: '#f74da6'}}>Seleccionado:</p>
                <p style={{margin: 0, fontSize: '14px'}}>{getSelectionLabel()}</p>
              </div>
            </div>
            <div style={{textAlign: 'right'}}>
              <p style={{margin: 0, fontSize: '24px', fontWeight: 'bold'}}>
                {isFree ? '¡GRATIS!' : `$${getCurrentPrice().toFixed(2)}`}
              </p>
            </div>
          </div>
        )}

        {/* Checkout Section — WhatsApp + CTA */}
        <div style={{
          background: 'rgba(255,255,255,0.05)', borderRadius: '20px', padding: '25px',
          animation: isVisible ? 'fadeInUp 0.8s ease-out 0.7s both' : 'none'
        }}>
          {/* Phone / WhatsApp — Redesigned for higher conversions */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(37,211,102,0.15), rgba(37,211,102,0.05))',
            border: '2px solid rgba(37,211,102,0.4)',
            borderRadius: '16px',
            padding: '20px',
            marginBottom: '22px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Subtle animated glow behind */}
            <div style={{
              position: 'absolute', top: '-50%', right: '-20%',
              width: '180px', height: '180px',
              background: 'radial-gradient(circle, rgba(37,211,102,0.12) 0%, transparent 70%)',
              borderRadius: '50%', pointerEvents: 'none'
            }} />

            <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', position: 'relative'}}>
              {/* WhatsApp SVG icon */}
              <div style={{
                width: '32px', height: '32px', borderRadius: '8px',
                background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <div style={{flex: 1}}>
                <p style={{margin: 0, color: 'white', fontSize: '15px', fontWeight: '700'}}>
                  Recibe la canción por teléfono o WhatsApp
                </p>
              </div>
              <span style={{
                color: '#25D366', fontSize: '11px', fontWeight: '700',
                background: 'rgba(37,211,102,0.15)', borderRadius: '6px',
                padding: '3px 10px', whiteSpace: 'nowrap',
                border: '1px solid rgba(37,211,102,0.3)',
                textTransform: 'uppercase', letterSpacing: '0.5px'
              }}>
                Recomendado
              </span>
            </div>

            <p style={{margin: '0 0 12px 0', color: 'rgba(255,255,255,0.7)', fontSize: '13px', lineHeight: 1.5, position: 'relative'}}>
              Recibe el link de descarga al instante — ábrelo, escúchalo y compártelo con quien quieras 🎁
            </p>

            <div style={{display: 'flex', alignItems: 'center', gap: '10px', position: 'relative'}}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'rgba(255,255,255,0.1)', borderRadius: '12px',
                padding: '0 14px',
                border: whatsappPhone.replace(/\D/g, '').length >= 10
                  ? '2px solid #25D366'
                  : '2px solid rgba(37,211,102,0.3)',
                flex: 1,
                transition: 'border-color 0.3s'
              }}>
                <input
                  type="tel"
                  value={whatsappPhone}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^\d\s\-\+\(\)]/g, '');
                    setWhatsappPhone(val);
                  }}
                  placeholder="📱 Tu teléfono o WhatsApp"
                  maxLength={20}
                  style={{
                    width: '100%', padding: '14px 0',
                    background: 'transparent', border: 'none',
                    color: 'white', fontSize: '16px', outline: 'none',
                    fontWeight: '500'
                  }}
                />
              </div>
              {whatsappPhone.replace(/\D/g, '').length >= 10 && (
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, animation: 'fadeIn 0.3s ease-out'
                }}>
                  <span style={{color: 'white', fontSize: '18px', fontWeight: 'bold'}}>✓</span>
                </div>
              )}
            </div>

            {/* A2P compliance + social proof */}
            <p style={{margin: '10px 0 0 0', color: 'rgba(255,255,255,0.4)', fontSize: '10px', lineHeight: 1.5, position: 'relative'}}>
              Al ingresar tu número, aceptas recibir tu canción y actualizaciones por mensaje. Puedes cancelar en cualquier momento respondiendo ALTO.
            </p>
          </div>

          {/* Checkout Button */}
          <button
            ref={checkoutCtaRef}
            onClick={handleCheckout}
            disabled={isCheckingOut || !hasSelection}
            style={{
              width: '100%', padding: '22px',
              background: hasSelection 
                ? 'linear-gradient(90deg, #e11d74, #c026d3)' 
                : 'rgba(255,255,255,0.08)',
              color: hasSelection ? 'white' : 'rgba(255,255,255,0.3)',
              border: 'none', borderRadius: '14px',
              fontSize: '20px', fontWeight: 'bold',
              cursor: hasSelection ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s',
              boxShadow: hasSelection ? '0 4px 25px rgba(225,29,116,0.5)' : 'none'
            }}
          >
            {isCheckingOut ? (
              <span>⏳ Procesando...</span>
            ) : !hasSelection ? (
              <span>👆 Primero selecciona una opción arriba</span>
            ) : isFree ? (
              <span>🎉 Descargar Gratis</span>
            ) : (
              <span>💳 {purchaseBoth ? 'Comprar Ambas Canciones' : 'Comprar Canción'}{videoAddon ? ' + Video' : ''} — ${getCurrentPrice().toFixed(2)}</span>
            )}
          </button>

          {/* All sales final disclaimer */}
          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: '11px', marginTop: '12px', lineHeight: 1.5, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
            🎵 Al comprar recibes la canción completa (~3-4 min) — lo que escuchaste es solo un preview de 35 segundos.
          </p>
          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '10px', marginTop: '8px', lineHeight: 1.5, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto' }}>
            Al comprar aceptas que todas las ventas son finales. Escucha la vista previa antes de comprar. No se ofrecen reembolsos.
          </p>

          {/* Trust badges */}
          <div style={{display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '20px', flexWrap: 'wrap'}}>
            <span style={{color: 'rgba(255,255,255,0.55)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px'}}>
              🔒 Pago Seguro
            </span>
            <span style={{color: 'rgba(255,255,255,0.55)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px'}}>
              ⚡ Descarga Instantánea
            </span>
            <span style={{color: 'rgba(255,255,255,0.55)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px'}}>
              ✨ Calidad Premium
            </span>
          </div>
        </div>

        {/* ===== VIDEO TESTIMONIALS (below checkout) ===== */}
        <div style={{ marginTop: '30px', marginBottom: '24px', animation: 'fadeInUp 0.5s ease-out' }}>
          <p style={{ textAlign: 'center', fontSize: '14px', color: 'rgba(255,255,255,0.6)', marginBottom: '14px', fontWeight: '600' }}>
            ⭐⭐⭐⭐⭐ Lo que dicen nuestros clientes
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { src: '/videos/testimonial3.mp4', id: 'tc1' },
              { src: '/videos/testimonial1.mp4', id: 'tc2' }
            ].map((vid) => (
              <div key={vid.id} style={{
                width: '200px', height: '280px', borderRadius: '16px', overflow: 'hidden',
                position: 'relative', border: '2px solid rgba(242,13,128,0.3)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)', cursor: 'pointer', flexShrink: 0
              }} onClick={() => handleTestimonialToggle(vid.id)}>
                <video ref={el => videoTestimonialRefs.current[vid.id] = el} src={vid.src} playsInline preload="metadata" onEnded={() => setPlayingTestimonial(null)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {playingTestimonial !== vid.id && (
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(transparent 40%, rgba(0,0,0,0.7))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(201,24,74,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(201,24,74,0.5)' }}>
                      <span style={{ fontSize: '20px', marginLeft: '3px' }}>▶</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', fontSize: '13px', color: '#f74da6', marginTop: '10px', fontStyle: 'italic' }}>
            "Mi esposa lloró de felicidad... el mejor regalo que le he dado" ⭐⭐⭐⭐⭐
          </p>
        </div>

        {/* ===== LO QUE RECIBES CHECKLIST ===== */}
        <div style={{
          background: 'rgba(242,13,128,0.08)', border: '1px solid rgba(242,13,128,0.2)',
          borderRadius: '14px', padding: '18px 22px', marginBottom: '24px', animation: 'fadeInUp 0.6s ease-out'
        }}>
          <p style={{ fontSize: '15px', fontWeight: '700', marginBottom: '12px', textAlign: 'center', color: '#f74da6' }}>
            🎁 Lo que recibes con tu compra:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
            {[
              { icon: '🎵', text: 'Canción completa (~2 min)' },
              { icon: '⚡', text: 'Descarga instantánea MP3' },
              { icon: '💬', text: 'Envío por teléfono o WhatsApp' },
              { icon: '♾️', text: 'Tuya para siempre' },
              { icon: '❤️', text: 'Personalizada con su nombre' },
              { icon: '🔒', text: 'Pago seguro con Stripe' }
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                <span style={{ fontSize: '16px' }}>{item.icon}</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={{textAlign: 'center', marginTop: '30px', color: 'rgba(255,255,255,0.3)', fontSize: '12px'}}>
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

        {/* ✅ Song 2 Ready Toast */}
        {song2Ready && (
          <div style={{
            position: 'fixed', bottom: '30px', left: '50%',
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
      </div>
    </div>
  );
}
