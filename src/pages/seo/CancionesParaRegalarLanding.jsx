import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../../App';
import SEOHead, { generateBreadcrumbData, generateFAQStructuredData } from '../../components/SEOHead';
import SEOLink from '../../components/SEOLink';
import { getAllGenres, getAllOccasions } from '../../data/seoData';
import { CenzoSignature } from '../../components/Cenzo';

/**
 * CancionesParaRegalarLanding — canonical page for the head "canciones para
 * regalar" gifting cluster (our largest non-branded search demand per Search
 * Console). Its OWN page, not an occasion-template entry: that template
 * hardcodes frames like "Haz este {ocasión} inolvidable" which only read
 * correctly for a real occasion noun.
 *
 * Design uses the real brand system: bougainvillea #E4795A on warm near-black
 * (landing-bg #1B1C48), Playfair Display headings (font-display), glass-morphism
 * cards, Material Symbols (loaded globally in index.html).
 *
 * The page LEADS WITH THE PRODUCT — real playable song samples and real customer
 * reaction videos. A page selling songs that contained no songs was the core
 * weakness of the first version.
 *
 * Integrity: no invented ratings or review counts anywhere. The only quantitative
 * claim is the real songs-created figure.
 */

const SAMPLES = [
  { id: 1, title: 'Corrido Tumbado', tag: 'Para un hermano, un amigo, un logro', emoji: '🎸', audioUrl: '/samples/corridos/tumbado.mp3' },
  { id: 2, title: 'Bachata Romántica', tag: 'Para tu pareja, un aniversario', emoji: '🌹', audioUrl: '/samples/bachata/muestra-romantica.mp3' },
  { id: 3, title: 'Balada Romántica', tag: 'Para mamá, para declararte', emoji: '💕', audioUrl: '/samples/sample-romantica-1.mp3' },
];

const REACTIONS = ['/videos/testimonial3.mp4', '/videos/testimonial1.mp4', '/videos/testimonial2.mp4'];

const STEPS = [
  { n: '1', t: 'Elige el género', d: 'Corrido, cumbia, bachata, mariachi… el estilo que a esa persona le encanta.' },
  { n: '2', t: 'Cuenta su historia', d: 'Su nombre, tu relación y los detalles que la hacen única.' },
  { n: '3', t: 'Escúchala', d: 'En minutos recibes 2 versiones y las escuchas antes de pagar.' },
  { n: '4', t: 'Regálala', d: 'Descargas el MP3 y lo mandas por WhatsApp al instante.' },
];

const FAQS = [
  { q: '¿Cuánto cuesta una canción personalizada para regalar?', a: 'Una canción personalizada cuesta $29.99 USD. Es un pago único, sin suscripción, e incluye dos versiones para que elijas tu favorita o te quedes con ambas. Está lista para descargar y regalar en minutos.' },
  { q: '¿A quién le puedo regalar una canción?', a: 'A quien quieras sorprender: tu pareja, tu mamá o papá, un amigo, tus hijos, tus abuelos. Funciona para aniversarios, cumpleaños, bodas, el Día de las Madres, o simplemente para decir "te quiero" sin ocasión.' },
  { q: '¿Puedo regalar una canción para una pareja o aniversario?', a: 'Sí. Es uno de los regalos más pedidos. Incluimos los nombres de los dos, cómo se conocieron y los detalles de su historia, en el género que más les guste: bachata, bolero, norteño y más.' },
  { q: '¿Puedo escucharla antes de pagar?', a: 'Sí. Recibes un preview de cada una de las dos versiones antes de decidir, así te aseguras de que te encanta antes de comprarla.' },
  { q: '¿Cómo entrego la canción de regalo?', a: 'Recibes un archivo MP3 de alta calidad al instante. Lo puedes enviar por WhatsApp, ponerlo en una tarjeta con un código QR, reproducirlo en la fiesta, o compartirlo por redes sociales y email.' },
  { q: '¿En qué géneros puedo pedir la canción?', a: 'En más de 20 géneros de música latina: corridos tumbados, cumbia, norteño, banda, mariachi, bachata, bolero, reggaetón y más. Tú eliges el estilo que mejor va con la persona.' },
];

// Real customer reaction clip — tap to play, first frame used as the poster.
function ReactionVideo({ src }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const showThumb = () => { try { v.currentTime = 0.1; } catch { /* ignore */ } };
    v.addEventListener('loadeddata', showThumb);
    return () => v.removeEventListener('loadeddata', showThumb);
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { v.currentTime = 0; v.play().catch(() => {}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  return (
    <div
      onClick={toggle}
      className="relative aspect-[9/16] w-full rounded-2xl overflow-hidden bg-black cursor-pointer group shadow-2xl border border-white/10"
    >
      <video ref={ref} src={src} playsInline preload="metadata" className="w-full h-full object-cover" onEnded={() => setPlaying(false)} />
      {!playing && (
        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#E4795A', boxShadow: '0 0 24px rgba(228,121,90,0.5)' }}>
            <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CancionesParaRegalarLanding() {
  const { navigateTo, setFormData } = useContext(AppContext);
  const [playingId, setPlayingId] = useState(null);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [openFaq, setOpenFaq] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => setDur(a.duration || 0);
    const onEnd = () => { setPlayingId(null); setTime(0); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  const play = (s) => {
    const a = audioRef.current;
    if (!a) return;
    a.src = s.audioUrl;
    setTime(0);
    a.play().then(() => setPlayingId(s.id)).catch(() => setPlayingId(null));
  };
  const pause = () => { audioRef.current?.pause(); setPlayingId(null); };

  const handleCreateSong = (genreSlug = null) => {
    const updates = {};
    if (genreSlug) {
      const g = getAllGenres().find((x) => x.slug === genreSlug);
      if (g) { updates.genre = g.id; updates.genreName = g.name; }
    }
    setFormData((prev) => ({ ...prev, ...updates }));
    navigateTo('occasion');
  };

  const popularGenres = ['corridos-tumbados', 'cumbia', 'norteno', 'banda-sinaloense', 'bachata', 'mariachi']
    .map((slug) => getAllGenres().find((g) => g.slug === slug))
    .filter(Boolean);
  const topOccasions = getAllOccasions().slice(0, 8);

  const breadcrumbs = [
    { name: 'Inicio', path: '/' },
    { name: 'Canciones para Regalar', path: '/canciones-para-regalar' },
  ];
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Canción Personalizada para Regalar',
      description: 'Una canción personalizada hecha para regalar: con el nombre de esa persona y su historia, en más de 20 géneros de música latina. Lista en minutos.',
      brand: { '@type': 'Brand', name: 'RegalosQueCantan' },
      offers: { '@type': 'Offer', price: '29.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: 'https://regalosquecantan.com/canciones-para-regalar' },
    },
    generateBreadcrumbData(breadcrumbs),
    generateFAQStructuredData(FAQS.map((f) => ({ question: f.q, answer: f.a }))),
  ].filter(Boolean);

  const ctaStyle = { background: 'linear-gradient(135deg, #E4795A, #c00a66)', boxShadow: '0 0 24px rgba(228,121,90,0.45)' };

  return (
    <>
      <SEOHead
        title="Canciones para Regalar: el Regalo Musical Personalizado"
        description="¿Buscas canciones para regalar? Creamos una canción personalizada con el nombre de esa persona y su historia, en corridos, cumbia, bachata y más. Escúchala antes de pagar, desde $29.99."
        canonical="/canciones-para-regalar"
        keywords="canciones para regalar, canción para regalar, regalar una canción, regalar canción personalizada, canciones personalizadas para regalar, canciones de regalo, canciones por encargo, regalo musical personalizado"
        structuredData={structuredData}
      />

      <audio ref={audioRef} preload="none" />

      <div className="min-h-screen bg-landing-bg text-white font-body overflow-x-hidden">

        {/* ─────────── HERO ─────────── */}
        <section className="relative px-6 pt-14 pb-20 md:pt-20 md:pb-28 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute left-1/2 top-[-10%] -translate-x-1/2 w-[680px] h-[680px] rounded-full blur-[130px]" style={{ background: 'rgba(228,121,90,0.16)' }} />
          </div>
          {/* real customer reaction photos, scattered behind the headline */}
          <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden opacity-25 md:opacity-30">
            {[
              { src: '/images/reactions/reaction9.jpg', cls: 'top-[4%] left-[-4%] md:left-[4%] w-32 md:w-44 rotate-[-8deg]' },
              { src: '/images/reactions/reaction2.jpg', cls: 'top-[7%] right-[-4%] md:right-[4%] w-28 md:w-40 rotate-[7deg]' },
              { src: '/images/reactions/reaction6.jpg', cls: 'bottom-[8%] left-[0%] md:left-[6%] w-28 md:w-40 rotate-[9deg]' },
              { src: '/images/reactions/reaction7.jpg', cls: 'bottom-[4%] right-[0%] md:right-[6%] w-32 md:w-44 rotate-[-6deg]' },
            ].map((p, i) => (
              <div key={i} className={`absolute ${p.cls} rounded-2xl overflow-hidden shadow-2xl`}>
                <img src={p.src} alt="" className="w-full h-auto object-cover" loading="lazy" />
              </div>
            ))}
          </div>

          <div className="relative z-10 max-w-3xl mx-auto text-center">
            <nav className="mb-8" aria-label="Breadcrumb">
              <ol className="flex items-center justify-center gap-2 text-xs text-white/55">
                <li><SEOLink to="landing" className="hover:text-white/80 transition-colors">Inicio</SEOLink></li>
                <li>/</li>
                <li className="text-white/70">Canciones para Regalar</li>
              </ol>
            </nav>

            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-7 border" style={{ background: 'rgba(228,121,90,0.10)', borderColor: 'rgba(228,121,90,0.25)' }}>
              <span className="text-[13px] font-bold" style={{ color: '#ff5cb0' }}>🎁 Más de 40,000 canciones creadas</span>
            </div>

            <h1 className="font-display text-4xl md:text-6xl lg:text-[4.25rem] font-black leading-[1.05] tracking-tight mb-6">
              Canciones para Regalar
              <span className="block mt-2 text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(100deg,#ff5cb0,#E4795A 55%,#ffb3d9)' }}>
                que nadie va a olvidar
              </span>
            </h1>

            <p className="text-lg md:text-xl text-white/60 max-w-xl mx-auto mb-9 leading-relaxed">
              Una canción hecha solo para esa persona — con su nombre, su historia
              y el género que le encanta. Lista en minutos.
            </p>

            <button onClick={() => handleCreateSong()} style={ctaStyle}
              className="inline-flex items-center justify-center gap-2.5 rounded-full font-extrabold text-white transition-all duration-300 hover:scale-[1.03] active:scale-95 text-lg md:text-xl px-10 py-5">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>music_note</span>
              Crear mi canción
            </button>

            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-7 text-sm text-white/60">
              <span>✓ Desde $29.99</span>
              <span>✓ Lista en minutos</span>
              <span>✓ La escuchas antes de pagar</span>
            </div>
          </div>
        </section>

        {/* ─────────── LISTEN — the product itself ─────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <span className="uppercase tracking-[0.28em] text-[11px] font-bold" style={{ color: '#ff5cb0' }}>🎧 Escucha primero</span>
              <h2 className="font-display text-3xl md:text-4xl font-black mt-3">Así suena una canción hecha para alguien</h2>
              <p className="text-white/50 mt-2.5">Ejemplos reales — así de personal va a sonar la tuya</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {SAMPLES.map((s) => {
                const isPlaying = playingId === s.id;
                const pct = isPlaying && dur > 0 ? (time / dur) * 100 : 0;
                return (
                  <div
                    key={s.id}
                    className="rounded-2xl border transition-all duration-300 overflow-hidden glass-morphism"
                    style={isPlaying ? { borderColor: 'rgba(228,121,90,0.6)', background: 'rgba(228,121,90,0.09)' } : undefined}
                  >
                    <div className="p-5">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => (isPlaying ? pause() : play(s))}
                          aria-label={isPlaying ? `Pausar ${s.title}` : `Escuchar ${s.title}`}
                          className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-all"
                          style={isPlaying
                            ? { background: '#E4795A', transform: 'scale(1.08)', boxShadow: '0 0 22px rgba(228,121,90,0.55)' }
                            : { background: 'rgba(255,255,255,0.10)' }}
                        >
                          <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {isPlaying ? 'pause' : 'play_arrow'}
                          </span>
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{s.emoji}</span>
                            <h3 className="font-bold text-white text-[15px] truncate">{s.title}</h3>
                          </div>
                          <p className="text-white/60 text-xs mt-0.5 truncate">{s.tag}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: '#E4795A' }} />
                        </div>
                        <span className="text-white/50 text-[10px] font-mono tabular-nums">
                          {isPlaying && dur > 0 ? `${Math.floor(time)}s` : '▶'}
                        </span>
                      </div>
                    </div>
                    {isPlaying && (
                      <div className="px-5 py-2 flex items-center gap-2 border-t" style={{ background: 'rgba(228,121,90,0.10)', borderColor: 'rgba(228,121,90,0.20)' }}>
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#E4795A' }} />
                        <span className="text-xs font-bold" style={{ color: '#ff5cb0' }}>Reproduciendo</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─────────── REACTIONS ─────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-9">
              <h2 className="font-display text-3xl md:text-4xl font-black">La reacción es el regalo</h2>
              <p className="text-white/50 mt-2.5">Momentos reales de gente escuchando su canción por primera vez</p>
            </div>
            {/* Mobile: swipeable row with cards big enough to actually SEE the
                reaction (a 3-up grid renders ~99px wide on a 375px phone —
                too small for a face). Desktop: 3-up grid. */}
            <div className="flex md:grid md:grid-cols-3 gap-4 md:gap-5 overflow-x-auto md:overflow-visible snap-x snap-mandatory -mx-6 px-6 md:mx-0 md:px-0 pb-2 md:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {REACTIONS.map((src) => (
                <div key={src} className="snap-center shrink-0 w-[62%] sm:w-[45%] md:w-auto">
                  <ReactionVideo src={src} />
                </div>
              ))}
            </div>
            <p className="text-center text-white/55 text-xs mt-4 md:hidden">Desliza para ver más →</p>
          </div>
        </section>

        {/* ─────────── HOW IT WORKS ─────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-4xl mx-auto">
            <h2 className="font-display text-3xl md:text-4xl font-black text-center mb-3">Cómo regalar una canción</h2>
            <p className="text-white/50 text-center mb-12">Toma menos de 5 minutos</p>
            <div className="grid md:grid-cols-4 gap-6">
              {STEPS.map((s) => (
                <div key={s.n} className="text-center">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-black mx-auto mb-4 text-white"
                    style={{ background: 'linear-gradient(135deg,#E4795A,#c00a66)', boxShadow: '0 0 18px rgba(228,121,90,0.35)' }}>
                    {s.n}
                  </div>
                  <h3 className="font-bold text-white mb-2">{s.t}</h3>
                  <p className="text-white/60 text-sm leading-relaxed">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─────────── WHY ─────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-4xl mx-auto">
            <h2 className="font-display text-3xl md:text-4xl font-black text-center mb-10">¿Por qué regalar una canción?</h2>
            <div className="grid md:grid-cols-3 gap-4">
              {[
                { icon: 'favorite', t: 'No se olvida', d: 'Los regalos comunes se guardan en un cajón. Una canción con su nombre se escucha una y otra vez, y se queda para siempre.' },
                { icon: 'auto_awesome', t: 'Única en el mundo', d: 'Cuenta su historia, sus apodos, sus momentos. Imposible de comprar en una tienda porque no existe otra igual.' },
                { icon: 'bolt', t: 'Sin esperar envíos', d: 'Está lista en minutos y se manda por WhatsApp. Perfecta incluso si te acordaste el mismo día.' },
              ].map((c) => (
                <div key={c.t} className="glass-morphism rounded-2xl p-6">
                  <span className="material-symbols-outlined text-3xl mb-3 block" style={{ color: '#E4795A', fontVariationSettings: "'FILL' 1" }}>{c.icon}</span>
                  <h3 className="font-bold text-white mb-2">{c.t}</h3>
                  <p className="text-white/50 text-sm leading-relaxed">{c.d}</p>
                </div>
              ))}
            </div>
            <p className="text-white/60 text-center text-sm leading-relaxed max-w-2xl mx-auto mt-8">
              No hace falta una fecha especial. Puedes regalar una canción para un cumpleaños o un aniversario,
              para el Día de las Madres o del Padre, para una boda o una quinceañera — o simplemente porque
              quieres decir "te quiero" de una forma que nadie olvida.
            </p>
          </div>
        </section>

        {/* ─────────── GENRES ─────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-4xl mx-auto">
            <h2 className="font-display text-3xl md:text-4xl font-black text-center mb-3">Elige el género</h2>
            <p className="text-white/50 text-center mb-10">Más de 20 géneros latinos — el estilo que a esa persona le gusta</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {popularGenres.map((g) => (
                <SEOLink
                  key={g.slug}
                  to={`generos/${g.slug}`}
                  className="flex items-center gap-4 glass-morphism rounded-2xl p-5 transition-all group hover:bg-white/[0.07]"
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0" style={{ background: 'rgba(228,121,90,0.10)', border: '1px solid rgba(228,121,90,0.22)' }}>
                    {g.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white transition-colors">{g.name}</h3>
                    <p className="text-xs text-white/55 line-clamp-2 mt-0.5">{g.description}</p>
                  </div>
                  <span className="material-symbols-outlined text-white/55 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all shrink-0">chevron_right</span>
                </SEOLink>
              ))}
            </div>
            <div className="text-center mt-8">
              <SEOLink to="generos" className="text-sm font-semibold text-white/50 hover:text-white transition-colors">Ver los 20+ géneros disponibles →</SEOLink>
            </div>
          </div>
        </section>

        {/* ─────────── OCCASIONS ─────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-4xl mx-auto">
            <h2 className="font-display text-3xl md:text-4xl font-black text-center mb-3">¿Para qué ocasión?</h2>
            <p className="text-white/50 text-center mb-10">Cada momento tiene su canción</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
              {topOccasions.map((o) => (
                <SEOLink key={o.slug} to={`ocasiones/${o.slug}`} className="glass-morphism rounded-2xl p-5 text-center block transition-all hover:bg-white/[0.07]">
                  <div className="text-3xl mb-2.5">{o.icon}</div>
                  <div className="font-semibold text-white text-sm">{o.name}</div>
                </SEOLink>
              ))}
            </div>
            <div className="text-center mt-8">
              <SEOLink to="ocasiones" className="text-sm font-semibold text-white/50 hover:text-white transition-colors">Ver todas las ocasiones →</SEOLink>
            </div>
          </div>
        </section>

        {/* ─────────── PRICE ─────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-lg mx-auto text-center">
            <div className="rounded-3xl p-9 border" style={{ background: 'linear-gradient(180deg, rgba(228,121,90,0.10), rgba(255,255,255,0.02))', borderColor: 'rgba(228,121,90,0.22)' }}>
              <p className="uppercase tracking-[0.22em] text-[11px] font-bold text-white/55 mb-3">Pago único · Sin suscripción</p>
              <div className="font-display text-5xl md:text-6xl font-black mb-2">$29.99</div>
              <p className="text-white/60 text-sm mb-8">2 versiones únicas · Descarga MP3 · Tuya para siempre</p>
              <button onClick={() => handleCreateSong()} style={ctaStyle}
                className="w-full inline-flex items-center justify-center gap-2.5 rounded-full font-extrabold text-white transition-all duration-300 hover:scale-[1.02] active:scale-95 text-lg px-8 py-4">
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>music_note</span>
                Crear mi canción
              </button>
              <p className="text-white/50 text-xs mt-4">🔒 Pago seguro · La escuchas antes de pagar</p>
            </div>
          </div>
        </section>

        {/* ─────────── FAQ ─────────── */}
        <section className="px-6 pb-20">
          <div className="max-w-2xl mx-auto">
            <h2 className="font-display text-3xl md:text-4xl font-black text-center mb-10">Preguntas frecuentes</h2>
            <div className="space-y-3">
              {FAQS.map((f, i) => {
                const open = openFaq === i;
                return (
                  <div key={i} className="rounded-2xl overflow-hidden border border-white/10">
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
                    >
                      <span className="font-semibold text-white text-[15px]">{f.q}</span>
                      <span className={`material-symbols-outlined shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: '#E4795A' }}>expand_more</span>
                    </button>
                    {open && <div className="px-5 pb-5 pt-1 text-white/55 text-sm leading-relaxed">{f.a}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─────────── FINAL CTA ─────────── */}
        <section className="relative px-6 pb-24 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-[560px] h-[380px] rounded-full blur-[120px]" style={{ background: 'rgba(228,121,90,0.13)' }} />
          </div>
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-5xl font-black mb-5 leading-tight">Regálale algo que se quede para siempre</h2>
            <p className="text-white/55 mb-9 text-lg">En unos minutos tienes una canción única, hecha solo para esa persona.</p>
            <button onClick={() => handleCreateSong()} style={ctaStyle}
              className="inline-flex items-center justify-center gap-2.5 rounded-full font-extrabold text-white transition-all duration-300 hover:scale-[1.03] active:scale-95 text-lg md:text-xl px-12 py-5">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>music_note</span>
              Crear mi canción — $29.99
            </button>
          </div>
        </section>

        <footer className="py-10 px-6 border-t border-white/5 text-center">
          <CenzoSignature className="justify-center mb-3" />
          <p className="text-white/55 text-sm">© {new Date().getFullYear()} RegalosQueCantan. Todos los derechos reservados.</p>
          <p className="mt-2 text-white/55 text-sm">Canciones personalizadas para regalar en géneros latinos, para cada persona y ocasión.</p>
        </footer>
      </div>
    </>
  );
}
