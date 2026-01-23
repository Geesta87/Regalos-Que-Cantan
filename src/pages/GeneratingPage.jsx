import React, { useContext, useEffect, useState, useRef } from 'react';
import { AppContext } from '../App';
import Header from '../components/Header';
import { generateSong, checkSongStatus } from '../services/api';

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
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [factIndex, setFactIndex] = useState(0);
  const [error, setError] = useState(null);
  const [songId, setSongId] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const hasStarted = useRef(false);
  const pollIntervalRef = useRef(null);

  // Check if this is a regeneration (version 2 already started)
  const isRegeneration = songData?.version === 2 && songData?.status === 'processing';

  const steps = isRegeneration ? [
    { icon: 'refresh', label: 'Creando nueva versión...' },
    { icon: 'edit_note', label: 'Escribiendo nueva letra...' },
    { icon: 'music_note', label: 'Componiendo melodía...' },
    { icon: 'check_circle', label: '¡Segunda versión casi lista!' }
  ] : [
    { icon: 'edit_note', label: 'Escribiendo la letra...' },
    { icon: 'music_note', label: 'Componiendo la melodía...' },
    { icon: 'graphic_eq', label: 'Produciendo la canción...' },
    { icon: 'check_circle', label: '¡Casi listo!' }
  ];

  // Rotate fun facts
  useEffect(() => {
    const factTimer = setInterval(() => {
      setFactIndex(prev => (prev + 1) % funFacts.length);
    }, 5000);
    return () => clearInterval(factTimer);
  }, []);

  // Progress animation
  useEffect(() => {
    const progressTimer = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return prev;
        return prev + Math.random() * 2;
      });
    }, 1000);
    return () => clearInterval(progressTimer);
  }, []);

  // Update step based on progress
  useEffect(() => {
    if (progress < 25) setCurrentStep(0);
    else if (progress < 50) setCurrentStep(1);
    else if (progress < 75) setCurrentStep(2);
    else setCurrentStep(3);
  }, [progress]);

  // Start generation or poll for regeneration
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    async function startGeneration() {
      try {
        // If this is a regeneration, we already have the songId from PreviewPage
        if (isRegeneration && songData?.id) {
          console.log('Regeneration mode - polling for:', songData.id);
          setSongId(songData.id);
          setIsPolling(true);
          return;
        }

        // Start new generation
        console.log('Starting song generation...');
        const result = await generateSong(formData);
        
        console.log('Generate result:', result);
        
        const id = result?.song?.id;
        
        if (result.success && id) {
          console.log('Song creation started, ID:', id);
          setSongId(id);
          setIsPolling(true);
          
          // Save sessionId for future regenerations
          if (result.sessionId) {
            setSongData(prev => ({
              ...prev,
              sessionId: result.sessionId
            }));
          }
        } else {
          throw new Error(result.error || 'No song ID returned');
        }
      } catch (err) {
        console.error('Generation error:', err);
        setError(err.message);
      }
    }

    startGeneration();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [formData, songData, isRegeneration]);

  // Poll for status
  useEffect(() => {
    if (!isPolling || !songId) return;

    async function pollStatus() {
      try {
        console.log('Polling status for:', songId);
        const result = await checkSongStatus(songId);
        
        console.log('Status result:', result);
        
        if (result.success && result.song) {
          console.log('Song status:', result.song.status);
          
          if (result.song.status === 'completed') {
            setProgress(100);
            clearInterval(pollIntervalRef.current);
            
            // Build completed song data
            const completedSong = {
              id: result.song.id,
              sessionId: result.song.sessionId,
              version: result.song.version || 1,
              previewUrl: result.song.previewUrl,
              audioUrl: result.song.audioUrl,
              imageUrl: result.song.imageUrl,
              title: `Canción para ${result.song.recipientName}`,
              genre: result.song.genre,
              genreName: result.song.genreName,
              subGenreName: result.song.subGenreName,
              lyrics: result.song.lyrics,
              paid: result.song.paid,
              canRegenerate: result.canRegenerate
            };

            // If this is version 2, keep reference to version 1
            if (isRegeneration && songData?.firstSong) {
              completedSong.firstSong = songData.firstSong;
            }

            setSongData(completedSong);
            
            // Navigate based on whether we have 2 songs now
            // For v2, go to comparison page to show both options
            if (isRegeneration || result.totalVersions >= 2) {
              setTimeout(() => navigateTo('comparison'), 1000);
            } else {
              setTimeout(() => navigateTo('preview'), 1000);
            }
            
          } else if (result.song.status === 'failed') {
            throw new Error('La generación de la canción falló. Por favor intenta de nuevo.');
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }

    pollIntervalRef.current = setInterval(pollStatus, 3000);
    pollStatus(); // Initial poll

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isPolling, songId, navigateTo, setSongData, isRegeneration, songData]);

  if (error) {
    return (
      <div className="min-h-screen bg-background-light dark:bg-background-dark flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-red-500">error</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Oops, algo salió mal
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">{error}</p>
            <button
              onClick={() => navigateTo('details')}
              className="px-6 py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition-colors"
            >
              Intentar de nuevo
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark flex flex-col">
      <Header />
      
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg text-center">
          {/* Animated Icon */}
          <div className="relative w-32 h-32 mx-auto mb-8">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-accent opacity-20 animate-ping" />
            <div className="absolute inset-2 rounded-full bg-gradient-to-r from-primary to-accent opacity-40 animate-pulse" />
            <div className="absolute inset-4 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center shadow-xl">
              <span className="material-symbols-outlined text-5xl text-primary animate-bounce">
                {steps[currentStep].icon}
              </span>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {isRegeneration ? 'Creando versión 2...' : 'Creando tu canción...'}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            Para: <span className="font-semibold text-primary">{formData.recipientName}</span>
            {isRegeneration && <span className="text-gold ml-2">• Nueva versión</span>}
          </p>

          {/* Progress Bar */}
          <div className="relative h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-4">
            <div 
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Progress Text */}
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-8">
            {steps[currentStep].label}
          </p>

          {/* Steps */}
          <div className="flex justify-center gap-2 mb-10">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                  idx <= currentStep
                    ? 'bg-primary text-white scale-110'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                }`}
              >
                <span className="material-symbols-outlined text-base">{step.icon}</span>
              </div>
            ))}
          </div>

          {/* Fun Fact */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">¿Sabías que?</p>
            <p className="text-gray-700 dark:text-gray-300 font-medium">
              {funFacts[factIndex]}
            </p>
          </div>

          {/* Time Estimate */}
          <p className="text-xs text-gray-400 mt-6">
            ⏱️ Tiempo estimado: 1-3 minutos
          </p>
        </div>
      </main>
    </div>
  );
}
