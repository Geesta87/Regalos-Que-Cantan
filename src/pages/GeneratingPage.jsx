import React, { useContext, useEffect, useState, useRef } from 'react';
import { AppContext } from '../App';
import { generateSong, checkSongStatus } from '../services/api';
import genres from '../config/genres';

// Personalized step messages based on what's actually happening
const getPersonalizedSteps = (recipientName, genre, occasion) => {
  const genreName = genres[genre]?.name || genre;
  
  return [
    { 
      icon: 'edit_note', 
      label: `Escribiendo la historia de ${recipientName}...`,
      detail: 'Nuestra IA está creando letras únicas'
    },
    { 
      icon: 'music_note', 
      label: `Componiendo melodía en estilo ${genreName}...`,
      detail: 'Seleccionando los instrumentos perfectos'
    },
    { 
      icon: 'mic', 
      label: `Grabando las voces para ${recipientName}...`,
      detail: 'Interpretando con emoción cada palabra'
    },
    { 
      icon: 'graphic_eq', 
      label: 'Mezclando y masterizando...',
      detail: 'Puliendo cada detalle del sonido'
    },
    { 
      icon: 'check_circle', 
      label: '¡Tu canción está casi lista!',
      detail: 'Preparando tu experiencia musical'
    }
  ];
};

// Fun facts that rotate
const funFacts = [
  "🎸 Los corridos tumbados nacieron en 2020 y revolucionaron la música regional mexicana",
  "🎺 La banda sinaloense usa más de 15 instrumentos diferentes",
  "💃 La cumbia tiene más de 100 variantes en Latinoamérica",
  "🎤 El mariachi fue declarado Patrimonio de la Humanidad por la UNESCO",
  "🌮 La música norteña nació en la frontera Texas-México en los 1800s",
  "🎵 Un corrido tradicional cuenta una historia completa en solo 3 minutos",
  "🪗 El acordeón llegó a México con inmigrantes alemanes en el siglo XIX",
  "❤️ Las rancheras expresan los sentimientos más profundos del alma mexicana",
  "🎹 El bajo sexto tiene 12 cuerdas y es esencial en la música norteña",
  "🎷 El norteño-sax fusiona el acordeón tradicional con saxofón moderno"
];

export default function GeneratingPage() {
  const { navigateTo, formData, songData, setSongData } = useContext(AppContext);
  
  // Progress & UI state
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [factIndex, setFactIndex] = useState(0);
  const [error, setError] = useState(null);
  
  // Song generation state
  const [song1Id, setSong1Id] = useState(null);
  const [song2Id, setSong2Id] = useState(null);
  const [song1Status, setSong1Status] = useState('pending'); // pending, generating, completed, failed
  const [song2Status, setSong2Status] = useState('pending');
  const [song1Data, setSong1Data] = useState(null);
  const [song2Data, setSong2Data] = useState(null);
  
  // Lyrics preview state
  const [lyricsPreview, setLyricsPreview] = useState('');
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsLines, setLyricsLines] = useState([]);
  const [visibleLines, setVisibleLines] = useState(0);
  
  // Refs
  const hasStarted = useRef(false);
  const pollInterval1Ref = useRef(null);
  const pollInterval2Ref = useRef(null);

  // Get personalized steps
  const steps = getPersonalizedSteps(formData.recipientName, formData.genre, formData.occasion);
  
  // Get genre info for display
  const genreConfig = genres[formData.genre];
  const genreName = genreConfig?.name || formData.genre;
  const subGenreName = formData.subGenre && genreConfig?.subGenres?.[formData.subGenre]?.name;

  // Rotate fun facts
  useEffect(() => {
    const factTimer = setInterval(() => {
      setFactIndex(prev => (prev + 1) % funFacts.length);
    }, 6000);
    return () => clearInterval(factTimer);
  }, []);

  // Progress animation - smoother and more realistic
  useEffect(() => {
    const progressTimer = setInterval(() => {
      setProgress(prev => {
        // Progress based on actual song status
        if (song1Status === 'completed' && song2Status === 'completed') return 100;
        if (song1Status === 'completed') return Math.min(prev + 0.5, 85);
        if (song1Status === 'generating') return Math.min(prev + 0.3, 50);
        if (prev >= 95) return prev;
        return prev + Math.random() * 1.5;
      });
    }, 800);
    return () => clearInterval(progressTimer);
  }, [song1Status, song2Status]);

  // Update step based on progress
  useEffect(() => {
    if (progress < 15) setCurrentStep(0);
    else if (progress < 35) setCurrentStep(1);
    else if (progress < 55) setCurrentStep(2);
    else if (progress < 80) setCurrentStep(3);
    else setCurrentStep(4);
  }, [progress]);

  // Animate lyrics appearing line by line
  useEffect(() => {
    if (lyricsLines.length > 0 && visibleLines < lyricsLines.length) {
      const timer = setTimeout(() => {
        setVisibleLines(prev => Math.min(prev + 1, lyricsLines.length));
      }, 400); // Reveal one line every 400ms
      return () => clearTimeout(timer);
    }
  }, [lyricsLines, visibleLines]);

  // Start two-song generation
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    async function startDualGeneration() {
      try {
        console.log('🎵 Starting dual song generation...');
        
        // Generate Song 1
        setSong1Status('generating');
        const result1 = await generateSong({
          ...formData,
          version: 1
        });
        
        if (result1.success && result1.song?.id) {
          console.log('✅ Song 1 started:', result1.song.id);
          setSong1Id(result1.song.id);
          
          // If we got lyrics back immediately, show them
          if (result1.song.lyrics) {
            const lines = result1.song.lyrics.split('\n').filter(l => l.trim());
            setLyricsLines(lines);
            setShowLyrics(true);
          }
          
          // Start Song 2 generation immediately (parallel)
          setSong2Status('generating');
          const result2 = await generateSong({
            ...formData,
            version: 2,
            sessionId: result1.sessionId // Link to same session
          });
          
          if (result2.success && result2.song?.id) {
            console.log('✅ Song 2 started:', result2.song.id);
            setSong2Id(result2.song.id);
          } else {
            console.warn('⚠️ Song 2 failed to start, continuing with single song');
            setSong2Status('failed');
          }
        } else {
          throw new Error(result1.error || 'Failed to start song generation');
        }
      } catch (err) {
        console.error('❌ Generation error:', err);
        setError(err.message);
      }
    }

    startDualGeneration();

    return () => {
      if (pollInterval1Ref.current) clearInterval(pollInterval1Ref.current);
      if (pollInterval2Ref.current) clearInterval(pollInterval2Ref.current);
    };
  }, [formData]);

  // Poll for Song 1 status
  useEffect(() => {
    if (!song1Id || song1Status === 'completed' || song1Status === 'failed') return;

    async function pollSong1() {
      try {
        const result = await checkSongStatus(song1Id);
        
        if (result.success && result.song) {
          // Update lyrics preview if available
          if (result.song.lyrics && !showLyrics) {
            const lines = result.song.lyrics.split('\n').filter(l => l.trim());
            setLyricsLines(lines);
            setShowLyrics(true);
          }
          
          if (result.song.status === 'completed') {
            console.log('✅ Song 1 completed!');
            // Set data first, then status (so the navigation effect has the data)
            const completedSong1 = {
              id: result.song.id,
              version: 1,
              audioUrl: result.song.audioUrl,
              previewUrl: result.song.previewUrl,
              imageUrl: result.song.imageUrl,
              lyrics: result.song.lyrics,
              title: `Versión 1 para ${formData.recipientName}`
            };
            setSong1Data(completedSong1);
            setSong1Status('completed');
            clearInterval(pollInterval1Ref.current);
          } else if (result.song.status === 'failed') {
            setSong1Status('failed');
            clearInterval(pollInterval1Ref.current);
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    pollInterval1Ref.current = setInterval(pollSong1, 3000);
    pollSong1();

    return () => {
      if (pollInterval1Ref.current) clearInterval(pollInterval1Ref.current);
    };
  }, [song1Id, song1Status, formData.recipientName, showLyrics]);

  // Poll for Song 2 status
  useEffect(() => {
    if (!song2Id || song2Status === 'completed' || song2Status === 'failed') return;

    async function pollSong2() {
      try {
        const result = await checkSongStatus(song2Id);
        
        if (result.success && result.song) {
          if (result.song.status === 'completed') {
            console.log('✅ Song 2 completed!');
            // Set data first, then status (so the navigation effect has the data)
            const completedSong2 = {
              id: result.song.id,
              version: 2,
              audioUrl: result.song.audioUrl,
              previewUrl: result.song.previewUrl,
              imageUrl: result.song.imageUrl,
              lyrics: result.song.lyrics,
              title: `Versión 2 para ${formData.recipientName}`
            };
            setSong2Data(completedSong2);
            setSong2Status('completed');
            clearInterval(pollInterval2Ref.current);
          } else if (result.song.status === 'failed') {
            setSong2Status('failed');
            clearInterval(pollInterval2Ref.current);
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    pollInterval2Ref.current = setInterval(pollSong2, 3000);
    pollSong2();

    return () => {
      if (pollInterval2Ref.current) clearInterval(pollInterval2Ref.current);
    };
  }, [song2Id, song2Status, formData.recipientName]);

  // Navigate when songs are ready
  const hasNavigated = useRef(false);
  
  useEffect(() => {
    // Prevent multiple navigations
    if (hasNavigated.current) return;
    
    const song1Ready = song1Status === 'completed' && song1Data;
    const song2Ready = song2Status === 'completed' || song2Status === 'failed';
    
    if (song1Ready && song2Ready) {
      hasNavigated.current = true; // Mark as navigated immediately
      setProgress(100);
      
      // Build song data for next page
      const songsArray = [song1Data];
      if (song2Data) songsArray.push(song2Data);
      
      const newSongData = {
        songs: songsArray,
        song1: song1Data,
        song2: song2Data,
        hasTwoSongs: !!song2Data,
        // Keep first song as primary for backwards compatibility
        ...song1Data
      };
      
      console.log('🎉 Both songs ready, preparing navigation...', newSongData);
      
      // Update state and navigate
      setSongData(newSongData);
      
      // Navigate after brief celebration moment
      const targetPage = song2Data ? 'comparison' : 'preview';
      console.log('🚀 Navigating to:', targetPage);
      
      setTimeout(() => {
        navigateTo(targetPage);
      }, 1500);
    }
  }, [song1Status, song2Status, song1Data, song2Data, setSongData, navigateTo]);

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-forest flex flex-col">
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-24 py-6">
          <h2 className="font-display text-white text-xl font-medium tracking-tight">RegalosQueCantan</h2>
        </header>
        
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-red-400">error</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Oops, algo salió mal</h2>
            <p className="text-white/60 mb-6">{error}</p>
            <button
              onClick={() => navigateTo('details')}
              className="px-8 py-4 bg-bougainvillea text-white rounded-full font-bold hover:scale-105 transition-transform"
            >
              Intentar de nuevo
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-forest text-white overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-forest via-forest to-background-dark"></div>
        {/* Floating music notes animation */}
        <div className="absolute inset-0 overflow-hidden opacity-10">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute text-gold animate-float"
              style={{
                left: `${15 + i * 15}%`,
                animationDelay: `${i * 0.5}s`,
                animationDuration: `${3 + i * 0.5}s`
              }}
            >
              <span className="material-symbols-outlined text-4xl">music_note</span>
            </div>
          ))}
        </div>
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-24 py-6">
        <h2 className="font-display text-white text-xl font-medium tracking-tight">RegalosQueCantan</h2>
        <div className="flex items-center gap-3">
          <span className="text-gold/80 text-xs font-bold uppercase tracking-widest">Creando magia</span>
          <span className="material-symbols-outlined text-gold animate-pulse">auto_awesome</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative pt-24 pb-12 flex flex-col items-center justify-center min-h-screen px-6">
        <div className="w-full max-w-2xl">
          
          {/* Hero Section */}
          <div className="text-center mb-8">
            {/* Animated Album Art Placeholder */}
            <div className="relative w-40 h-40 mx-auto mb-6">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-gold/30 to-bougainvillea/30 animate-pulse"></div>
              <div className="absolute inset-2 rounded-xl bg-forest flex items-center justify-center">
                <div className="relative">
                  <span className="material-symbols-outlined text-6xl text-gold animate-bounce">
                    {steps[currentStep].icon}
                  </span>
                  {/* Ripple effect */}
                  <div className="absolute inset-0 rounded-full bg-gold/20 animate-ping"></div>
                </div>
              </div>
              {/* Song version indicators */}
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-2">
                <div className={`w-3 h-3 rounded-full transition-all ${song1Status === 'completed' ? 'bg-green-400' : song1Status === 'generating' ? 'bg-gold animate-pulse' : 'bg-white/20'}`}></div>
                <div className={`w-3 h-3 rounded-full transition-all ${song2Status === 'completed' ? 'bg-green-400' : song2Status === 'generating' ? 'bg-gold animate-pulse' : 'bg-white/20'}`}></div>
              </div>
            </div>

            {/* Title */}
            <h1 className="font-display text-3xl md:text-4xl font-bold text-white mb-2">
              Creando 2 versiones para <span className="text-gold">{formData.recipientName}</span>
            </h1>
            <p className="text-white/60 text-lg">
              {genreName}{subGenreName ? ` • ${subGenreName}` : ''}
            </p>
          </div>

          {/* Progress Section */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6 mb-6">
            {/* Current Step */}
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-gold/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-gold text-2xl">{steps[currentStep].icon}</span>
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">{steps[currentStep].label}</p>
                <p className="text-white/50 text-sm">{steps[currentStep].detail}</p>
              </div>
              <span className="text-gold font-bold">{Math.round(progress)}%</span>
            </div>

            {/* Progress Bar */}
            <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-gold to-bougainvillea rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
            </div>

            {/* Step Indicators */}
            <div className="flex justify-between mt-4">
              {steps.map((step, idx) => (
                <div key={idx} className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    idx < currentStep ? 'bg-green-500 text-white' :
                    idx === currentStep ? 'bg-gold text-forest scale-110' :
                    'bg-white/10 text-white/30'
                  }`}>
                    {idx < currentStep ? (
                      <span className="material-symbols-outlined text-sm">check</span>
                    ) : (
                      <span className="material-symbols-outlined text-sm">{step.icon}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Version Status */}
            <div className="flex justify-center gap-6 mt-6 pt-4 border-t border-white/10">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${song1Status === 'completed' ? 'bg-green-400' : 'bg-gold animate-pulse'}`}></div>
                <span className="text-sm text-white/60">Versión 1: {song1Status === 'completed' ? '✓ Lista' : 'Creando...'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${song2Status === 'completed' ? 'bg-green-400' : song2Status === 'failed' ? 'bg-red-400' : 'bg-gold animate-pulse'}`}></div>
                <span className="text-sm text-white/60">Versión 2: {song2Status === 'completed' ? '✓ Lista' : song2Status === 'failed' ? '✗ Error' : 'Creando...'}</span>
              </div>
            </div>
          </div>

          {/* Lyrics Preview Section */}
          {showLyrics && lyricsLines.length > 0 && (
            <div className="bg-gradient-to-br from-gold/10 to-bougainvillea/10 backdrop-blur-sm border border-gold/20 rounded-2xl p-6 mb-6 overflow-hidden">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-gold">lyrics</span>
                <h3 className="text-gold font-bold uppercase tracking-widest text-sm">Preview de la Letra</h3>
              </div>
              
              <div className="space-y-2 max-h-48 overflow-hidden relative">
                {lyricsLines.slice(0, 8).map((line, idx) => (
                  <p 
                    key={idx}
                    className={`text-white/90 italic transition-all duration-500 ${
                      idx < visibleLines ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                    }`}
                    style={{ transitionDelay: `${idx * 100}ms` }}
                  >
                    {line}
                  </p>
                ))}
                {/* Fade out at bottom */}
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-forest/90 to-transparent pointer-events-none"></div>
              </div>
              
              <p className="text-gold/60 text-xs mt-4 text-center">
                ✨ Tu letra personalizada se está convirtiendo en música...
              </p>
            </div>
          )}

          {/* Fun Fact */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5">
            <p className="text-gold/70 text-xs uppercase tracking-widest mb-2">¿Sabías que?</p>
            <p className="text-white/80 font-medium transition-all duration-500">
              {funFacts[factIndex]}
            </p>
          </div>

          {/* Time Estimate */}
          <p className="text-center text-white/40 text-sm mt-6">
            ⏱️ Tiempo estimado: 2-4 minutos para ambas versiones
          </p>
        </div>
      </main>

      {/* Custom Animations */}
      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(100vh) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-100px) rotate(360deg); opacity: 0; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-float {
          animation: float 8s ease-in-out infinite;
        }
        .animate-shimmer {
          animation: shimmer 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
