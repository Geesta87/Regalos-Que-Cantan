import React, { useContext, useState, useEffect } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';

const inspirationPrompts = [
  { id: 'memories', label: 'Recuerdos Especiales', prompt: '¿Qué momentos han compartido que nunca olvidarán?' },
  { id: 'qualities', label: 'Cualidades Únicas', prompt: '¿Qué hace especial a esta persona?' },
  { id: 'dates', label: 'Fechas Clave', prompt: '¿Hay fechas importantes en su historia?' },
  { id: 'places', label: 'Lugares Favoritos', prompt: '¿Hay lugares que significan algo para ustedes?' },
  { id: 'nicknames', label: 'Apodos Cariñosos', prompt: '¿Tienen apodos o palabras especiales?' },
  { id: 'dreams', label: 'Sueños y Metas', prompt: '¿Qué sueños o logros quieres celebrar?' }
];

export default function DetailsStep() {
  const { formData, updateFormData, navigateTo } = useContext(AppContext);
  const [details, setDetails] = useState(formData.details || '');
  const [activePrompt, setActivePrompt] = useState(null);
  const [showQualityWarning, setShowQualityWarning] = useState(false);
  // "Usar mi propia letra" — when on, the buyer pastes/writes the exact lyrics
  // and we skip the AI story-based generation entirely.
  const [useOwnLyrics, setUseOwnLyrics] = useState(formData.useCustomLyrics || false);
  const [customLyrics, setCustomLyrics] = useState(formData.customLyrics || '');
  const [lyricsError, setLyricsError] = useState(false);
  // Optional free-text notes the AI composer takes into account (story mode only).
  const [songwriterNotes, setSongwriterNotes] = useState(formData.songwriterNotes || '');
  const maxNotesChars = 500;
  const maxLyricsChars = 4000;
  const minLyricsChars = 20;   // hard floor — below this, block (basically empty)
  const shortLyricsChars = 120; // soft nudge — below this, warn it may be too short for a full song

  // Track page view
  useEffect(() => {
    trackStep('details');
  }, []);

  // Persist the right fields for the chosen mode, then advance. In own-lyrics
  // mode we clear `details` (and vice-versa) so stale text from the other mode
  // never reaches the backend.
  const saveAndGo = () => {
    updateFormData('useCustomLyrics', useOwnLyrics);
    updateFormData('customLyrics', useOwnLyrics ? customLyrics : '');
    updateFormData('details', useOwnLyrics ? '' : details);
    // Notes only apply when WE compose (story mode); cleared in own-lyrics mode.
    updateFormData('songwriterNotes', useOwnLyrics ? '' : songwriterNotes.trim());
    navigateTo('email');
  };

  const handleContinue = () => {
    if (useOwnLyrics) {
      const len = customLyrics.trim().length;
      // The song is sung with these exact words — block if essentially empty.
      if (len < minLyricsChars) {
        setLyricsError(true);
        return;
      }
      // Soft nudge: a few words won't fill a song — the music app would just
      // loop/stretch them. Warn once, but let them continue if they insist.
      if (len < shortLyricsChars && !showQualityWarning) {
        setShowQualityWarning(true);
        return;
      }
      saveAndGo();
      return;
    }
    // Story mode — nudge if the story is very short, otherwise continue.
    if (details.length > 0 && details.length < 50 && !showQualityWarning) {
      setShowQualityWarning(true);
      return;
    }
    saveAndGo();
  };

  const handleContinueAnyway = () => {
    saveAndGo();
  };

  const handleBack = () => {
    navigateTo('names');
  };

  const handlePromptClick = (prompt) => {
    if (activePrompt === prompt.id) {
      setActivePrompt(null);
    } else {
      setActivePrompt(prompt.id);
    }
  };

  const charCount = details.length;
  const maxChars = 2000;

  // Quality indicator — use full Tailwind class strings (dynamic interpolation breaks JIT)
  const getQualityLevel = () => {
    if (charCount === 0) return { level: 'empty', label: 'Vacío', dotClass: 'bg-white/30', textClass: 'text-white/30' };
    if (charCount < 50) return { level: 'low', label: 'Básico', dotClass: 'bg-yellow-400', textClass: 'text-yellow-400' };
    if (charCount < 150) return { level: 'medium', label: 'Bueno', dotClass: 'bg-gold', textClass: 'text-gold' };
    return { level: 'high', label: '¡Excelente!', dotClass: 'bg-green-400', textClass: 'text-green-400' };
  };

  const quality = getQualityLevel();

  return (
    <div className="bg-forest text-white antialiased min-h-screen">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 md:px-24 py-6 bg-forest/80 backdrop-blur-md">
        <div 
          className="flex items-center gap-2 group cursor-pointer"
          onClick={() => navigateTo('landing')}
        >
          <h2 className="font-display text-white text-2xl font-medium tracking-tight">
            RegalosQueCantan
          </h2>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-2 h-2 rounded-full bg-gold/30"></div>
            <div className="w-8 h-2 rounded-full bg-gold"></div>
            <div className="w-2 h-2 rounded-full bg-white/10"></div>
          </div>
          <span className="text-gold/80 text-xs font-bold uppercase tracking-widest">Paso 4 de 5</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative pt-32 pb-20 flex flex-col items-center justify-start min-h-screen overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 w-full h-full pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-forest via-forest to-background-dark"></div>
        </div>

        <div className="relative z-10 container mx-auto px-6 max-w-4xl">
          {/* Title */}
          <div className="text-center mb-10">
            <span className="text-gold uppercase tracking-[0.4em] text-[10px] font-bold mb-4 block">Personaliza tu Mensaje</span>
            <h1 className="font-display text-4xl md:text-6xl font-black mb-4 leading-tight">
              Cuéntanos la <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-gold via-white to-gold">historia</span>
            </h1>
            <p className="text-white/60 text-base font-light max-w-xl mx-auto">
              Los mejores temas nacen de las anécdotas más pequeñas. Cuéntanos sobre {formData.recipientName || 'esta persona'} y su relación.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Main textarea section */}
            <div className="lg:col-span-2 space-y-4">
              {/* Mode toggle: tell us the story (AI writes the lyrics) vs. use
                  your own lyrics (sung exactly as submitted). */}
              <div className="bg-white/[0.03] border border-gold/20 rounded-2xl p-2 flex gap-2">
                <button
                  onClick={() => { setUseOwnLyrics(false); setLyricsError(false); }}
                  className={`flex-1 rounded-xl px-4 py-3 text-sm font-bold transition-all ${!useOwnLyrics ? 'bg-bougainvillea text-white shadow-lg' : 'text-white/60 hover:text-white'}`}
                >
                  <span className="material-symbols-outlined text-base align-middle mr-1">auto_awesome</span>
                  Cuéntanos la historia
                </button>
                <button
                  onClick={() => { setUseOwnLyrics(true); setShowQualityWarning(false); }}
                  className={`flex-1 rounded-xl px-4 py-3 text-sm font-bold transition-all ${useOwnLyrics ? 'bg-bougainvillea text-white shadow-lg' : 'text-white/60 hover:text-white'}`}
                >
                  <span className="material-symbols-outlined text-base align-middle mr-1">edit_note</span>
                  Usar mi propia letra
                </button>
              </div>

              {/* Disclaimer steering each buyer to the right option. */}
              <p className="text-white/55 text-xs leading-relaxed px-1">
                ¿Ya tienes tu letra escrita? Elige <span className="text-gold/90 font-semibold">"Usar mi propia letra"</span> y copia y pega tu letra aquí — la cantaremos tal cual. ¿No tienes una letra propia? Quédate en <span className="text-gold/90 font-semibold">"Cuéntanos la historia"</span>, escríbenos los detalles y nosotros la creamos por ti.
              </p>

              {!useOwnLyrics && (<>
              {/* Accuracy reminder */}
              <div className="bg-bougainvillea/15 border-2 border-bougainvillea/50 rounded-xl px-5 py-4 shadow-lg shadow-bougainvillea/5">
                <p className="text-white/90 text-sm leading-relaxed">
                  ⚠️ <strong>Revisa bien los nombres, las fechas y la ortografía.</strong> Tu canción se crea exactamente con la información que escribas aquí — <strong>este es el momento de incluir todo lo que quieras que tenga.</strong>
                </p>
              </div>

              {/* Active prompt hint */}
              {activePrompt && (
                <div className="bg-gold/10 border border-gold/30 rounded-xl p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-gold">lightbulb</span>
                  <div>
                    <p className="text-gold font-medium text-sm">
                      {inspirationPrompts.find(p => p.id === activePrompt)?.prompt}
                    </p>
                  </div>
                  <button 
                    onClick={() => setActivePrompt(null)}
                    className="ml-auto text-white/50 hover:text-white"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
              )}

              <div className="relative">
                <textarea
                  value={details}
                  onChange={(e) => {
                    setDetails(e.target.value.slice(0, maxChars));
                    setShowQualityWarning(false);
                  }}
                  placeholder={`Escribe aquí los momentos especiales con ${formData.recipientName || 'esta persona'}, sus apodos cariñosos, o ese lugar donde todo comenzó...`}
                  className="w-full h-72 bg-white/5 border border-gold/20 rounded-2xl p-6 text-white focus:ring-1 focus:ring-gold focus:border-gold outline-none transition-all resize-none text-base leading-relaxed placeholder:italic placeholder:text-gold/40"
                />
                <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
                  {/* Quality indicator */}
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${quality.dotClass}`}></div>
                    <span className={`text-xs font-medium ${quality.textClass}`}>
                      {quality.label}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold tracking-widest text-gold/60 uppercase">
                    {charCount} / {maxChars}
                  </span>
                </div>
              </div>

              {/* Inspiration tags */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Ideas para incluir:</span>
                <div className="flex flex-wrap gap-2">
                  {inspirationPrompts.map((prompt) => (
                    <button
                      key={prompt.id}
                      onClick={() => handlePromptClick(prompt)}
                      className={`
                        px-4 py-2 rounded-full text-xs font-medium transition-all flex items-center gap-2
                        ${activePrompt === prompt.id
                          ? 'bg-gold/20 border border-gold text-gold'
                          : 'bg-white/10 hover:bg-white/20 border border-white/10 text-white/70'}
                      `}
                    >
                      <span className="text-gold">✦</span>
                      {prompt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Requests to the composer — elevated into a visible card so buyers
                  add specific asks UP FRONT (an exact line, a must-mention, or where
                  it goes) rather than after delivery. Pairs with the requested-line
                  guarantee in generate-song. */}
              <div className="bg-gold/[0.07] border-2 border-gold/40 rounded-2xl p-5 space-y-3 shadow-lg shadow-gold/5">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-gold text-xl">star</span>
                  <span className="text-sm font-extrabold text-gold uppercase tracking-widest">
                    ¿Hay algo que no puede faltar? <span className="text-white/40 normal-case font-normal tracking-normal">(opcional)</span>
                  </span>
                </div>
                <p className="text-white/75 text-sm leading-relaxed">
                  Este es el momento perfecto para pedirlo. Si quieres que la canción diga una <strong className="text-white">frase exacta</strong> (por ejemplo: "te amo, papá"), que <strong className="text-white">mencione</strong> un nombre, un recuerdo o un detalle importante, o incluso <strong className="text-white">dónde</strong> te gustaría que vaya (al inicio, en el coro o al final), escríbelo aquí. Nos aseguramos de incluirlo. 💛
                </p>
                <textarea
                  value={songwriterNotes}
                  onChange={(e) => setSongwriterNotes(e.target.value.slice(0, maxNotesChars))}
                  placeholder={`Ej: que al final diga "siempre serás mi héroe"; que mencione a sus tres hijos: Ana, Luis y Sofía...`}
                  className="w-full h-24 bg-white/5 border border-gold/30 rounded-xl p-4 text-white focus:ring-1 focus:ring-gold focus:border-gold outline-none transition-all resize-none text-sm leading-relaxed placeholder:italic placeholder:text-gold/40"
                />
                <div className="text-right">
                  <span className="text-[10px] font-bold tracking-widest text-gold/60 uppercase">
                    {songwriterNotes.length} / {maxNotesChars}
                  </span>
                </div>
              </div>
              </>)}

              {/* Own-lyrics mode: the song is sung with these EXACT words. */}
              {useOwnLyrics && (
                <div className="space-y-4">
                  <div className="bg-yellow-400/15 border-2 border-yellow-400/70 rounded-2xl px-6 py-5 shadow-lg shadow-yellow-400/10">
                    <p className="text-yellow-300 text-base md:text-lg font-extrabold uppercase tracking-wide mb-2 flex items-center gap-2">
                      <span className="text-2xl leading-none">⚠️</span> Importante — solo para letras completas
                    </p>
                    <p className="text-white text-sm md:text-base leading-relaxed">
                      Usa esta opción <strong>SOLO si ya tienes la letra COMPLETA de una canción</strong> — con sus <strong>versos, coro (el gancho que se repite) y puente</strong>. Cantaremos <strong>exactamente</strong> lo que escribas aquí, palabra por palabra — y <strong>solo eso, aunque sea corto</strong>. No la modificaremos.
                    </p>
                    <p className="text-white/85 text-sm leading-relaxed mt-3">
                      ¿Solo tienes datos, fechas o anécdotas (no una letra ya compuesta)? <strong>No los pegues aquí</strong> — usa{' '}
                      <button
                        type="button"
                        onClick={() => { setUseOwnLyrics(false); setLyricsError(false); }}
                        className="text-gold font-bold underline underline-offset-2 hover:text-gold/80"
                      >
                        "Cuéntanos la historia"
                      </button>{' '}
                      y nosotros componemos la letra por ti.
                    </p>
                  </div>
                  <div className="relative">
                    <textarea
                      value={customLyrics}
                      onChange={(e) => {
                        setCustomLyrics(e.target.value.slice(0, maxLyricsChars));
                        setLyricsError(false);
                      }}
                      placeholder={`Pega o escribe aquí tu letra completa...\n\n[Verso 1]\nTu primera estrofa...\n\n[Coro]\nEl gancho que se repite...\n\nPuedes incluir o no las etiquetas como [Verso], [Coro], [Puente].`}
                      className="w-full h-96 bg-white/5 border border-gold/20 rounded-2xl p-6 text-white focus:ring-1 focus:ring-gold focus:border-gold outline-none transition-all resize-none text-base leading-relaxed placeholder:italic placeholder:text-gold/40 whitespace-pre-wrap"
                    />
                    <div className="absolute bottom-4 right-6">
                      <span className="text-[10px] font-bold tracking-widest text-gold/60 uppercase">
                        {customLyrics.length} / {maxLyricsChars}
                      </span>
                    </div>
                  </div>
                  {lyricsError && (
                    <p className="text-yellow-400 text-sm flex items-center gap-2">
                      <span className="material-symbols-outlined text-base">info</span>
                      Escribe la letra completa de tu canción para continuar (mínimo {minLyricsChars} caracteres).
                    </p>
                  )}
                  <p className="text-white/40 text-xs leading-relaxed">
                    El género que elegiste ({formData.subGenreName || formData.genreName || formData.genre || 'tu estilo'}) define la música; tu letra define las palabras. Consejo: las etiquetas <span className="text-gold/70">[Verso]</span>, <span className="text-gold/70">[Coro]</span> ayudan a que suene mejor, pero son opcionales.
                  </p>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <aside className="space-y-6">
              <div className="bg-white/[0.03] backdrop-blur-sm border border-gold/20 p-6 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <span className="material-symbols-outlined text-gold">tips_and_updates</span>
                  <h3 className="font-bold text-sm tracking-widest uppercase">Consejo</h3>
                </div>
                <p className="text-white/70 text-sm leading-relaxed mb-4">
                  No te preocupes por la redacción. Cuanto más natural y específico sea lo que escribas, más auténtica sonará la letra.
                </p>
                <div className="pt-4 border-t border-gold/10 space-y-2">
                  <p className="text-[10px] text-gold/50 italic leading-snug">
                    "Siempre nos reímos de aquella vez que perdimos el tren en Madrid..."
                  </p>
                  <p className="text-[10px] text-gold/50 italic leading-snug">
                    "Le digo 'gordito' aunque ya no lo es..."
                  </p>
                </div>
              </div>

              <div className="bg-white/[0.03] backdrop-blur-sm border border-gold/20 p-6 rounded-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <span className="material-symbols-outlined text-gold">auto_awesome</span>
                  <h3 className="font-bold text-sm tracking-widest uppercase">Tu canción incluirá</h3>
                </div>
                <ul className="text-white/50 text-xs space-y-2">
                  <li className="flex items-center gap-2">
                    <span className="text-gold">✓</span>
                    Nombre: <span className="text-white">{formData.recipientName || '---'}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-gold">✓</span>
                    De: <span className="text-white">{formData.senderName || '---'}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-gold">✓</span>
                    Género: <span className="text-white">{formData.genre || '---'}</span>
                  </li>
                  {formData.artistInspiration && (
                    <li className="flex items-center gap-2">
                      <span className="text-gold">✓</span>
                      Estilo: <span className="text-white">{formData.artistInspiration}</span>
                    </li>
                  )}
                </ul>
              </div>
            </aside>
          </div>

          {/* Navigation */}
          <div className="mt-12 flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-white/5">
            <button
              onClick={handleBack}
              className="text-white/40 hover:text-white transition-colors flex items-center gap-2 group uppercase text-xs font-bold tracking-[0.2em]"
            >
              <span className="material-symbols-outlined text-sm group-hover:-translate-x-1 transition-transform">arrow_back</span>
              Volver
            </button>
            <button
              onClick={handleContinue}
              className="group relative flex min-w-[280px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-16 px-12 bg-bougainvillea text-white text-lg font-bold shadow-2xl transition-all hover:scale-105 active:scale-95"
            >
              <span className="relative z-10 flex items-center gap-2">
                Continuar
                <span className="material-symbols-outlined">arrow_forward</span>
              </span>
              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity"></div>
            </button>
          </div>
        </div>

        {/* Decorative corners */}
        <div className="absolute top-32 left-8 w-32 h-32 border-l border-t border-gold/10 opacity-40 hidden xl:block"></div>
        <div className="absolute bottom-32 right-8 w-32 h-32 border-r border-b border-gold/10 opacity-40 hidden xl:block"></div>
      </main>

      {/* Quality Warning Modal */}
      {showQualityWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowQualityWarning(false)}
          ></div>
          
          <div className="relative bg-forest border border-gold/30 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <div className="text-center mb-6">
              <span className="material-symbols-outlined text-yellow-400 text-5xl mb-4">info</span>
              {useOwnLyrics ? (
                <>
                  <h3 className="font-display text-2xl font-bold text-white mb-2">¿Letra muy corta?</h3>
                  <p className="text-white/60 text-sm">
                    Una canción completa suele tener varias estrofas y un coro. Con tan poca letra,
                    la música puede repetirla o sonar muy corta. Puedes agregar más, o si prefieres
                    que nosotros la escribamos, vuelve y elige <strong className="text-gold/90">"Cuéntanos la historia"</strong>.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="font-display text-2xl font-bold text-white mb-2">¿Pocos detalles?</h3>
                  <p className="text-white/60 text-sm">
                    Las canciones con más detalles son mucho más personales y emotivas.
                    ¿Te gustaría agregar más información sobre {formData.recipientName}?
                  </p>
                </>
              )}
            </div>

            <div className="bg-white/5 rounded-xl p-4 mb-6">
              {useOwnLyrics ? (
                <>
                  <p className="text-gold text-xs uppercase tracking-widest font-bold mb-2">Una letra completa suele incluir:</p>
                  <ul className="text-white/70 text-sm space-y-1">
                    <li>• Uno o dos versos (estrofas)</li>
                    <li>• Un coro que se repite</li>
                    <li>• Las palabras tal como quieres escucharlas</li>
                  </ul>
                </>
              ) : (
                <>
                  <p className="text-gold text-xs uppercase tracking-widest font-bold mb-2">Ideas:</p>
                  <ul className="text-white/70 text-sm space-y-1">
                    <li>• Un recuerdo especial que compartieron</li>
                    <li>• Un apodo cariñoso</li>
                    <li>• Algo que hace única a esta persona</li>
                  </ul>
                </>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowQualityWarning(false)}
                className="flex-1 py-4 rounded-full font-bold bg-gold/20 text-gold hover:bg-gold/30 transition-all"
              >
                Agregar más
              </button>
              <button
                onClick={handleContinueAnyway}
                className="flex-1 py-4 rounded-full font-bold bg-white/10 text-white/70 hover:bg-white/20 transition-all"
              >
                Continuar así
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-background-dark py-10 px-8 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="font-display text-white/50 text-xl">RegalosQueCantan</div>
          <div className="flex gap-10">
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">Privacidad</a>
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">Términos</a>
            <a className="text-white/30 hover:text-gold transition-colors text-xs uppercase tracking-widest" href="#">FAQ</a>
          </div>
          <p className="text-white/20 text-xs">© 2026 RegalosQueCantan.</p>
        </div>
      </footer>
    </div>
  );
}
