import React, { useContext, useState } from 'react';
import { AppContext } from '../App';
import Header from '../components/Header';
import ProgressBar from '../components/ProgressBar';
import { CenzoGuide } from '../components/Cenzo';

// Sub-genre definitions with Suno-friendly prompts
const subGenresByGenre = {
  corrido: {
    title: '¿Qué estilo de Corrido?',
    options: [
      {
        id: 'clasico',
        name: 'Clásico',
        emoji: '🎸',
        description: 'Tradicional con acordeón',
        prompt: 'traditional corrido, accordion, bajo sexto, polka rhythm, narrative storytelling vocals, norteño, 1990s regional Mexican, classic corrido'
      },
      {
        id: 'tumbado',
        name: 'Tumbado',
        emoji: '🔥',
        description: 'Moderno con trap beats',
        prompt: 'corrido tumbado, trap 808 bass, acoustic requinto guitar, melancholic male vocals, slow tempo 75 BPM, regional Mexican trap, sad boy aesthetic, modern production'
      },
      {
        id: 'romantico',
        name: 'Romántico',
        emoji: '❤️',
        description: 'Historia de amor',
        prompt: 'romantic corrido, emotional vocals, accordion, love story ballad, norteño romance, heartfelt Mexican ballad, sentimental'
      }
    ]
  },
  norteno: {
    title: '¿Qué estilo de Norteño?',
    options: [
      {
        id: 'tradicional',
        name: 'Tradicional',
        emoji: '🪗',
        description: 'Acordeón clásico',
        prompt: 'traditional norteño, classic accordion, bajo sexto, polka rhythm, Tex-Mex, 1980s regional Mexican, conjunto style'
      },
      {
        id: 'moderno',
        name: 'Moderno',
        emoji: '✨',
        description: 'Producción actual',
        prompt: 'modern norteño, polished production, accordion, romantic lyrics, contemporary regional Mexican, radio-friendly norteño'
      },
      {
        id: 'romantico',
        name: 'Romántico',
        emoji: '💕',
        description: 'Balada norteña',
        prompt: 'romantic norteño ballad, emotional accordion, slow tempo, love song, sentimental norteño, heartfelt'
      }
    ]
  },
  banda: {
    title: '¿Qué estilo de Banda?',
    options: [
      {
        id: 'sinaloense',
        name: 'Sinaloense',
        emoji: '🎺',
        description: 'Tradicional con metales',
        prompt: 'traditional banda sinaloense, brass band, tubas, trumpets, clarinets, tambora drum, powerful vocals, Mexican brass, Sinaloa style'
      },
      {
        id: 'pop',
        name: 'Pop/Moderna',
        emoji: '🎤',
        description: 'Estilo radio actual',
        prompt: 'modern pop banda, polished production, radio-friendly, romantic brass, contemporary Mexican banda, crossover appeal'
      },
      {
        id: 'romantica',
        name: 'Romántica',
        emoji: '💔',
        description: 'Balada con banda',
        prompt: 'romantic banda ballad, slow brass arrangement, emotional powerful vocals, string accents, sentimental sinaloense, tearjerker'
      }
    ]
  },
  cumbia: {
    title: '¿Qué estilo de Cumbia?',
    options: [
      {
        id: 'texana',
        name: 'Texana',
        emoji: '🤠',
        description: 'Estilo Tex-Mex',
        prompt: 'cumbia texana, accordion driven, Tex-Mex cumbia, synthesizer, keyboard riffs, danceable, American Latin cumbia'
      },
      {
        id: 'colombiana',
        name: 'Colombiana',
        emoji: '🇨🇴',
        description: 'Tropical original',
        prompt: 'traditional Colombian cumbia, tropical, conga drums, accordion, guacharaca, classic cumbia rhythm, Caribbean coast style'
      },
      {
        id: 'sonidera',
        name: 'Sonidera',
        emoji: '📻',
        description: 'Estilo sonidero mexicano',
        prompt: 'cumbia sonidera, Mexican soundsystem style, heavy bass, reverb effects, tropical urbano, party cumbia, wepa drops'
      },
      {
        id: 'nortena',
        name: 'Norteña',
        emoji: '🪗',
        description: 'Con acordeón',
        prompt: 'cumbia norteña, accordion cumbia, bajo sexto, regional Mexican cumbia, danceable, norteño rhythm blend'
      }
    ]
  },
  ranchera: {
    title: '¿Qué estilo de Ranchera?',
    options: [
      {
        id: 'clasica',
        name: 'Clásica',
        emoji: '🎻',
        description: 'Mariachi tradicional',
        prompt: 'classic ranchera, full mariachi orchestra, violins, trumpets, vihuela, guitarrón, powerful emotional vocals, traditional Mexican ranchera'
      },
      {
        id: 'bravia',
        name: 'Bravía',
        emoji: '🔥',
        description: 'Alegre y con garra',
        prompt: 'ranchera bravia, uptempo mariachi, energetic, defiant lyrics, celebratory, powerful brass, lively Mexican folk'
      },
      {
        id: 'romantica',
        name: 'Romántica',
        emoji: '🌹',
        description: 'Balada ranchera',
        prompt: 'romantic ranchera ballad, slow mariachi, emotional strings, passionate vocals, tearful Mexican ballad, sentimental bolero ranchero'
      }
    ]
  },
  balada: {
    title: '¿Qué estilo de Balada?',
    options: [
      {
        id: 'clasica',
        name: 'Clásica',
        emoji: '🎹',
        description: 'Orquestal dramática',
        prompt: 'classic Latin ballad, orchestral arrangement, piano, strings, dramatic vocals, 1980s romantic Spanish ballad, emotional crescendos'
      },
      {
        id: 'pop',
        name: 'Pop Moderna',
        emoji: '🎧',
        description: 'Producción actual',
        prompt: 'modern Latin pop ballad, contemporary production, acoustic guitar, subtle electronic elements, radio-friendly romantic, clean vocals'
      },
      {
        id: 'ranchera',
        name: 'Ranchera',
        emoji: '🎺',
        description: 'Balada con mariachi',
        prompt: 'ranchera ballad, mariachi backing, romantic Mexican ballad, strings and brass, passionate vocals, bolero ranchero fusion'
      }
    ]
  },
  reggaeton: {
    title: '¿Qué estilo de Reggaetón?',
    options: [
      {
        id: 'clasico',
        name: 'Clásico',
        emoji: '🎤',
        description: 'Old school 2000s',
        prompt: 'classic reggaeton, dembow beat, 2000s Puerto Rican reggaeton, dancehall influence, perreo, old school reggaeton'
      },
      {
        id: 'romantico',
        name: 'Romántico',
        emoji: '💕',
        description: 'Lento y sensual',
        prompt: 'romantic reggaeton, slow dembow, R&B influenced, sensual, Latin urban ballad, smooth vocals, bedroom vibes'
      },
      {
        id: 'perreo',
        name: 'Perreo/Club',
        emoji: '🔥',
        description: 'Para la fiesta',
        prompt: 'perreo reggaeton, heavy dembow, club banger, aggressive 808 bass, Latin trap influenced, party anthem, high energy'
      },
      {
        id: 'pop',
        name: 'Pop Urbano',
        emoji: '✨',
        description: 'Crossover radio',
        prompt: 'pop reggaeton, radio-friendly, mainstream Latin urban, catchy hooks, polished production, crossover appeal, modern urbano'
      }
    ]
  },
  salsa: {
    title: '¿Qué estilo de Salsa?',
    options: [
      {
        id: 'clasica',
        name: 'Clásica/Dura',
        emoji: '🥁',
        description: 'Estilo Fania',
        prompt: 'classic salsa dura, heavy percussion, piano montuno, congas, timbales, brass section, Fania style, 1970s New York salsa, Cuban son influence'
      },
      {
        id: 'romantica',
        name: 'Romántica',
        emoji: '❤️',
        description: 'Suave y amorosa',
        prompt: 'salsa romantica, smooth romantic salsa, lush arrangements, love song lyrics, 1990s salsa sensual, ballad tempo sections'
      },
      {
        id: 'urbana',
        name: 'Urbana',
        emoji: '🏙️',
        description: 'Fusión moderna',
        prompt: 'urban salsa, modern fusion, reggaeton influences, contemporary production, salsa choke elements, Colombian urban salsa'
      }
    ]
  }
};

export default function SubGenreStep() {
  const { navigateTo, formData, updateFormData } = useContext(AppContext);
  const [selectedSubGenre, setSelectedSubGenre] = useState(formData.subGenre || '');
  const [artistInput, setArtistInput] = useState(formData.artistInspiration || '');

  const genreData = subGenresByGenre[formData.genre];
  
  if (!genreData) {
    // Fallback if genre not found
    navigateTo('genre');
    return null;
  }

  const handleSubGenreSelect = (subGenre) => {
    setSelectedSubGenre(subGenre.id);
  };

  const handleContinue = () => {
    if (selectedSubGenre) {
      const selected = genreData.options.find(opt => opt.id === selectedSubGenre);
      updateFormData('subGenre', selectedSubGenre);
      updateFormData('subGenrePrompt', selected?.prompt || '');
      updateFormData('artistInspiration', artistInput.trim());
      navigateTo('occasion');
    }
  };

  return (
    <div className="night-sky min-h-screen transition-colors">
      <Header />
      
      <main className="max-w-2xl mx-auto px-6 py-12">
        {/* Progress */}
        <div className="flex justify-center w-full mb-8">
          <ProgressBar step={2} label="Personaliza el estilo" />
        </div>

        {/* Title */}
        <div className="text-center mb-10">
          <CenzoGuide size={132} className="mx-auto mb-2 md:mb-3" />
          <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
            {genreData.title}
          </h1>
          <p className="text-ink-2">
            Cada estilo tiene su propio sonido único
          </p>
        </div>

        {/* Sub-Genre Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {genreData.options.map((option) => (
            <button
              key={option.id}
              onClick={() => handleSubGenreSelect(option)}
              className={`p-5 rounded-2xl border-2 transition-all duration-300 text-left ${
                selectedSubGenre === option.id
                  ? 'border-primary bg-primary/10 shadow-lg scale-[1.02]'
                  : 'border-white/15 bg-forest hover:border-primary/50 hover:shadow-md'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl ${
                  selectedSubGenre === option.id 
                    ? 'bg-primary/20' 
                    : 'bg-white/10'
                }`}>
                  {option.emoji}
                </div>
                <div className="flex-1">
                  <h3 className={`text-lg font-bold mb-1 ${
                    selectedSubGenre === option.id ? 'text-primary' : 'text-white'
                  }`}>
                    {option.name}
                  </h3>
                  <p className="text-sm text-ink-2">
                    {option.description}
                  </p>
                </div>
                {selectedSubGenre === option.id && (
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-sm">check</span>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Artist Inspiration Field */}
        <div className="bg-forest rounded-2xl border border-white/15 p-6 mb-8">
          <label className="block mb-3">
            <span className="text-sm font-semibold text-ink-2 flex items-center gap-2">
              <span className="text-lg">🎵</span>
              ¿Algún artista que te inspire?
              <span className="text-ink-2 font-normal">(opcional)</span>
            </span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={artistInput}
              onChange={(e) => setArtistInput(e.target.value)}
              className="w-full p-4 pr-12 rounded-xl border border-white/15 bg-white/5 text-white text-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all placeholder:text-ink-2"
              placeholder="Ej: Peso Pluma, Bad Bunny, Vicente Fernández..."
            />
            <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-ink-2">
              music_note
            </span>
          </div>
          <p className="mt-3 text-xs text-ink-2 flex items-start gap-2">
            <span className="material-symbols-outlined text-primary text-sm mt-0.5">lightbulb</span>
            <span>Usaremos su estilo musical para inspirar tu canción. Puedes escribir uno o varios artistas.</span>
          </p>
        </div>

        {/* Navigation */}
        <div className="flex gap-4">
          <button
            onClick={() => navigateTo('genre')}
            className="flex-1 py-4 rounded-xl font-semibold border-2 border-white/15 text-ink-2 hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            Atrás
          </button>
          <button
            onClick={handleContinue}
            disabled={!selectedSubGenre}
            className={`flex-[2] py-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 ${
              selectedSubGenre
                ? 'bg-primary hover:bg-primary-dark shadow-lg shadow-primary/30 hover:shadow-xl hover:scale-[1.02]'
                : 'bg-white/20 cursor-not-allowed'
            }`}
          >
            Continuar
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      </main>
    </div>
  );
}
