import React, { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../App';
import SEOHead from '../components/SEOHead';
import { CenzoMark } from '../components/Cenzo';

// ============================================================================
// TRENDS LAB — internal preview of new product verticals (NOT linked anywhere)
//
// Route: /trends (hidden, noindex). Every "DEMO REAL" below was generated
// through the production generate-song pipeline (email
// trends-demo@regalosquecantan.com), so what you hear is exactly what a
// customer would receive. Audio lives in the public Supabase Storage bucket
// (the pipeline rehosts takes there), so the URLs are stable. If any of these
// verticals launches, copy the keepers into public/samples/trends/ so the
// samples don't depend on unpaid-song rows sticking around.
// ============================================================================

// Demo audio generated 2026-08-29 through the live pipeline. Each demo has
// two takes (the pipeline always renders two versions); url is take 1, url2
// take 2. null url = take not ready; the card shows a placeholder instead.
const AUDIO_BASE = 'https://yzbvajungshqcpusfiia.supabase.co/storage/v1/object/public/audio/songs';
const DEMO_AUDIO = {
  jingle: {
    songId: '0a27fdd6-0d3a-4003-a4e3-13181d1fb339',
    url: `${AUDIO_BASE}/cancion-para-taqueria-el-guero-0a27fdd6.mp3`,
    url2: `${AUDIO_BASE}/cancion-para-taqueria-el-guero-34175dea.mp3`,
    label: 'Jingle — Taquería El Güero (cumbia)',
  },
  roast: {
    songId: '25e30769-ddb5-4afd-bd70-7bcf157ef340',
    url: `${AUDIO_BASE}/cancion-para-el-compadre-beto-25e30769.mp3`,
    url2: `${AUDIO_BASE}/cancion-para-el-compadre-beto-16bcfd57.mp3`,
    label: 'Roast — el Compadre Beto (banda)',
  },
  anthem: {
    songId: '9c271953-20c3-46a6-ad0a-59f8acf828bc',
    url: `${AUDIO_BASE}/cancion-para-los-halcones-de-oro-9c271953.mp3`,
    url2: `${AUDIO_BASE}/cancion-para-los-halcones-de-oro-c6d0ee33.mp3`,
    label: 'Himno — Los Halcones de Oro (banda)',
  },
  sonidero: {
    songId: 'f715112d-1575-4bef-8e2b-165396e7e657',
    url: `${AUDIO_BASE}/cancion-para-sonido-la-furia-f715112d.mp3`,
    url2: `${AUDIO_BASE}/cancion-para-sonido-la-furia-10b0df36.mp3`,
    label: 'Presentación — Sonido La Furia (cumbia sonidera)',
  },
  'corrido-compa': {
    songId: '7df4191a-ee89-44e8-96d0-187548449843',
    url: `${AUDIO_BASE}/cancion-para-el-compa-chuy-7df4191a.mp3`,
    url2: `${AUDIO_BASE}/cancion-para-el-compa-chuy-0766dbc8.mp3`,
    label: 'Corrido — el Compa Chuy (tumbado)',
  },
  walkup: {
    songId: 'f0bd0e96-9503-4ad7-96b1-e6940e97c1f0',
    url: `${AUDIO_BASE}/cancion-para-el-tigre-ramirez-f0bd0e96.mp3`,
    url2: `${AUDIO_BASE}/cancion-para-el-tigre-ramirez-324117ad.mp3`,
    label: 'Entrada al ring — El Tigre Ramírez (bélico)',
  },
  'promo-mes': {
    songId: '46941132-649e-4c8d-a401-cc7ad1d1e410',
    url: `${AUDIO_BASE}/cancion-para-taqueria-el-guero-46941132.mp3`,
    url2: `${AUDIO_BASE}/cancion-para-taqueria-el-guero-8289545d.mp3`,
    label: 'Promo — Martes de Tacos (reggaetón)',
  },
};

const GROUPS = [
  {
    id: 'humor',
    emoji: '🔥',
    title: 'Humor y Hype',
    blurb: 'La otra mitad del mercado: no un regalo sentimental, sino la canción que presume, vacila o corona a alguien. Hecha para compartirse — cada venta es publicidad.',
    items: [
      {
        key: 'roast', emoji: '😂', name: 'Roast de Cumpleaños',
        tag: 'DEMO REAL', demoKey: 'roast', price: '$34.99',
        pitch: 'Una canción de broma cariñosa que hace reír a toda la fiesta. Burlas entre compadres, cero crueldad, 100% compartible.',
        buyer: 'Compadres, amigos, oficinas. Compra grupal natural (cooperacha).',
        funnel: '/roast',
      },
      {
        key: 'corrido-compa', emoji: '🤠', name: 'El Corrido de Tu Compa',
        tag: 'DEMO REAL', demoKey: 'corrido-compa', price: '$39.99',
        pitch: 'El corrido que cuenta la historia real de alguien que salió adelante. La versión "status" del roast: empezó de abajo, hoy tiene su trailer.',
        buyer: 'El compa se lo regala a sí mismo o entre amigos. Cultura de corridos tumbados = demanda enorme.',
        funnel: '/corridos (ya existe — agregar ángulo "para mí / mi compa")',
      },
      {
        key: 'walkup', emoji: '🥊', name: 'Música de Entrada',
        tag: 'DEMO REAL', demoKey: 'walkup', price: '$39.99',
        pitch: 'Entrada épica al ring, a la cancha o al escenario. Boxeadores, luchadores, softball, fútbol llanero — 60 segundos que intimidan.',
        buyer: 'Atletas amateur, entrenadores, promotores locales.',
        funnel: '/entrada',
      },
      {
        key: 'carclub', emoji: '🚗', name: 'Himno del Car Club',
        tag: 'CONCEPTO', price: '$59–99',
        pitch: 'Corrido o cumbia oficial del club, con el nombre del club y sus miembros. Comunidades cerradas: una venta corre por todo el scene.',
        buyer: 'Car clubs, lowrider clubs, moto clubs. Compra grupal.',
        funnel: '/club',
      },
      {
        key: 'squad', emoji: '🍻', name: 'Himno de la Palomilla',
        tag: 'CONCEPTO', price: '$49.99 grupal',
        pitch: 'La canción del grupo de amigos: mitad celebración, mitad roast de cada quien. Un link de cooperacha y todos aparecen en la letra.',
        buyer: 'Grupos de WhatsApp. El checkout grupal recluta 5–10 correos por venta.',
        funnel: '/palomilla',
      },
    ],
  },
  {
    id: 'equipos',
    emoji: '⚽',
    title: 'Equipos y Comunidad',
    blurb: 'Una canción que canta un grupo entero. El comprador es uno, la audiencia son cientos — y la porra completa oye el nombre de la marca.',
    items: [
      {
        key: 'anthem', emoji: '🦅', name: 'Himno de Tu Equipo',
        tag: 'DEMO REAL', demoKey: 'anthem', price: '$49.99',
        pitch: 'El himno oficial del equipo con coro de estadio para gritar en grupo. Liga dominical, equipos de empresa, ligas infantiles.',
        buyer: 'Capitanes, entrenadores, papás del equipo.',
        funnel: '/himnos',
      },
      {
        key: 'entrada-xv', emoji: '👑', name: 'Entrada de Quinceañera',
        tag: 'CONCEPTO', price: '$49.99',
        pitch: 'La música de entrada del cortejo y de la quinceañera — su nombre cantado al entrar al salón. Nicho real y sin competencia directa.',
        buyer: 'Mamás organizadoras, planners de XV años. Puerta al paquete completo de video-invitación.',
        funnel: '/xv',
      },
      {
        key: 'iglesia', emoji: '⛪', name: 'Coros e Himnos Institucionales',
        tag: 'CONCEPTO', price: '$149+',
        pitch: 'Coros para grupos de jóvenes, himnos de aniversario de iglesia, himnos escolares y de academias. Presupuesto institucional, no bolsillo personal.',
        buyer: 'Pastores, directores, comités. Cero competencia en español.',
        funnel: '/instituciones',
      },
    ],
  },
  {
    id: 'negocios',
    emoji: '💼',
    title: 'Negocios (B2B)',
    blurb: 'El mismo pipeline, precio de gasto de negocio. La pieza clave: la LICENCIA COMERCIAL — el costo de generar es igual, el permiso de uso vale 3–8×.',
    items: [
      {
        key: 'jingle', emoji: '🌮', name: 'Jingle Comercial',
        tag: 'DEMO REAL', demoKey: 'jingle', price: '$99 con licencia comercial',
        pitch: 'El jingle pegajoso que repite el nombre del negocio. Para status de WhatsApp, reels, radio local y el altavoz del local.',
        buyer: 'Taquerías, salones, florerías, dealerships, agentes de bienes raíces.',
        funnel: '/jingles',
      },
      {
        key: 'promo-mes', emoji: '📲', name: 'Promo del Mes (suscripción)',
        tag: 'DEMO REAL', demoKey: 'promo-mes', price: '$49/mes',
        pitch: 'Cada mes, una canción nueva anunciando la promoción del negocio ("martes de tacos 2x1"), lista para estados y reels. Convierte el jingle de $99 en ingreso recurrente.',
        buyer: 'Restaurantes y food trucks que ya compraron su jingle.',
        funnel: 'upsell dentro de /jingles',
      },
      {
        key: 'ivr', emoji: '☎️', name: 'Música en Espera',
        tag: 'CONCEPTO', price: '$79',
        pitch: 'El jingle extendido a loop de 2–3 minutos con voz promocional para el teléfono del negocio. Invisible, aburrido, y los negocios lo pagan sin regatear.',
        buyer: 'Talleres, clínicas, despachos. Add-on natural del jingle.',
        funnel: 'add-on dentro de /jingles',
      },
      {
        key: 'campana', emoji: '🗳️', name: 'Canción de Campaña',
        tag: 'CONCEPTO', price: '$299+ por temporada',
        pitch: 'Cumbias con el nombre del candidato — cada ciclo electoral local se compran por docenas. Estacional, precio premium, términos de servicio claros.',
        buyer: 'Campañas locales, consultores políticos.',
        funnel: 'venta directa / WhatsApp',
      },
      {
        key: 'hr', emoji: '🎂', name: 'Cumpleaños Corporativo',
        tag: 'CONCEPTO', price: '$29/mes por empresa',
        pitch: 'Suscripción para empresas: cada empleado recibe su canción de cumpleaños automática. 100% piloto automático con la infraestructura de fechas que ya existe.',
        buyer: 'HR de negocios pequeños y medianos.',
        funnel: '/empresas',
      },
    ],
  },
  {
    id: 'creadores',
    emoji: '🎚️',
    title: 'Creadores y DJs',
    blurb: 'Compradores que regresan: un DJ no compra un drop, compra drops toda su carrera. El mejor LTV de todas las líneas.',
    items: [
      {
        key: 'sonidero', emoji: '🔊', name: 'DJ Drops y Presentación de Sonidero',
        tag: 'DEMO REAL', demoKey: 'sonidero', price: '$29 el drop · pack 5×$79',
        pitch: 'La presentación oficial que anuncia al sonidero con su nombre y eco, más drops cortos para mezclar toda la noche.',
        buyer: 'Sonideros, DJs de fiesta, MCs. Compran packs y regresan.',
        funnel: '/drops',
      },
      {
        key: 'podcast', emoji: '🎙️', name: 'Tema para Podcast o Canal',
        tag: 'CONCEPTO', price: '$79–149 kit completo',
        pitch: 'Intro, outro y cortinillas con el nombre del show. El mercado de creadores en español está casi sin atender.',
        buyer: 'Podcasters, YouTubers, streamers latinos.',
        funnel: '/creadores',
      },
      {
        key: 'tiktok', emoji: '📱', name: 'Hooks para TikTok',
        tag: 'CONCEPTO', price: '$49 por hook',
        pitch: 'Audios de 15 segundos hechos para que una marca o creador intente volverlos tendencia. Especulativo por unidad, pero compran en serie.',
        buyer: 'Marcas pequeñas, agencias, creadores.',
        funnel: 'dentro de /creadores',
      },
    ],
  },
];

const LICENSE_TIERS = [
  {
    name: 'Personal', price: '$29.99', color: 'border-white/10',
    desc: 'El precio actual. Uso personal y familiar: regalos, fiestas, redes personales.',
    bullets: ['Regalos y celebraciones', 'Redes sociales personales', 'Lo que ya vendemos hoy'],
  },
  {
    name: 'Comercial', price: '$99', color: 'border-turquesa', featured: true,
    desc: 'Misma canción, permiso de negocio. El margen está aquí: el costo de generación es idéntico.',
    bullets: ['Anuncios del negocio y redes comerciales', 'Radio local y altavoz del local', 'Jingles, promos, drops de DJ'],
  },
  {
    name: 'Comercial Plus', price: '$249', color: 'border-marigold',
    desc: 'Campañas pagadas y uso amplio: pauta en Meta/TikTok, campañas políticas, cadenas.',
    bullets: ['Pauta publicitaria pagada', 'Campañas y temporadas completas', 'Varias sucursales / entidades'],
  },
];

const ROADMAP = [
  { phase: '1', title: 'Jingles + Licencia Comercial', detail: 'Funnel /jingles con los 3 niveles de licencia. Desbloquea todo el B2B: promo del mes, música en espera y campañas cuelgan de aquí.' },
  { phase: '2', title: 'DJ Drops', detail: 'Funnel /drops con packs. El comprador recurrente más claro; reutiliza el flujo de jingles con prompts propios.' },
  { phase: '3', title: 'Roast + Corrido del Compa', detail: 'El motor viral. Landing /roast con demos y checkout grupal (cooperacha) para que la palomilla pague entre todos.' },
];

// ── Small audio player ──────────────────────────────────────────────────────
function DemoPlayer({ demo, playingKey, onToggle }) {
  const isPlaying = playingKey === demo.key;
  if (!demo.url) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-dashed border-white/15 px-4 py-3">
        <span className="text-xl">⏳</span>
        <span className="text-white/50 text-sm">Demo en el horno — se generó hoy con el pipeline real, el audio se agrega en cuanto Kie lo entrega.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => onToggle(demo)}
        className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 border transition-all text-left ${
          isPlaying ? 'bg-turquesa/15 border-turquesa' : 'bg-white/[0.04] border-white/10 hover:border-turquesa/50'
        }`}
      >
        <span className={`flex items-center justify-center w-10 h-10 rounded-full text-black font-bold text-lg shrink-0 ${isPlaying ? 'bg-turquesa' : 'bg-white/90'}`}>
          {isPlaying ? '❚❚' : '▶'}
        </span>
        <span className="min-w-0">
          <span className="block text-white text-sm font-semibold truncate">{demo.label}</span>
          <span className="block text-turquesa text-xs">Generado con el pipeline de producción · {isPlaying ? 'sonando…' : 'toca para escuchar'}</span>
        </span>
      </button>
      {demo.url2 && (
        <a
          href={demo.url2} target="_blank" rel="noreferrer"
          className="text-white/40 hover:text-turquesa text-xs self-end transition-colors"
        >
          escuchar toma 2 ↗
        </a>
      )}
    </div>
  );
}

export default function TrendsPage() {
  const { navigateTo } = useContext(AppContext);
  const audioRef = useRef(null);
  const [playingKey, setPlayingKey] = useState(null);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnd = () => setPlayingKey(null);
    audio.addEventListener('ended', onEnd);
    return () => audio.removeEventListener('ended', onEnd);
  }, []);

  const togglePlay = (demo) => {
    const audio = audioRef.current;
    if (!audio || !demo.url) return;
    if (playingKey === demo.key) {
      audio.pause();
      setPlayingKey(null);
      return;
    }
    audio.src = demo.url;
    audio.play().catch(() => setPlayingKey(null));
    setPlayingKey(demo.key);
  };

  const demoCount = Object.values(DEMO_AUDIO).filter(d => d.url).length;
  const demosWithKeys = Object.fromEntries(
    Object.entries(DEMO_AUDIO).map(([k, v]) => [k, { key: k, ...v }])
  );

  return (
    <div className="night-sky min-h-screen bg-paper text-white">
      <SEOHead title="Trends Lab (interno)" description="Vista interna de nuevas líneas de producto." noindex />
      <audio ref={audioRef} preload="none" />

      {/* Header */}
      <header className="bg-[#191A45]/80 backdrop-blur-md py-4 px-6 md:px-12 border-b border-white/5 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigateTo('landing')}>
            <CenzoMark size={40} />
            <h2 className="font-display text-white text-xl font-medium tracking-tight">RegalosQueCantan</h2>
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-marigold bg-marigold/10 border border-marigold/30 rounded-full px-3 py-1.5">
            🧪 Trends Lab · interno
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute" style={{ top: '10%', left: '50%', transform: 'translateX(-50%)', width: 700, height: 400, background: 'radial-gradient(ellipse, rgba(67,194,186,0.14) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div className="relative z-10 max-w-4xl mx-auto px-6 pt-16 pb-12 text-center">
          <h1 className="font-display text-4xl md:text-6xl font-black tracking-tighter leading-tight mb-5">
            Nuevas líneas:{' '}
            <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-turquesa via-marigold to-terra">
              Hype, Negocios y DJs
            </span>
          </h1>
          <p className="text-white/70 text-lg leading-relaxed max-w-2xl mx-auto mb-6">
            La misma máquina que hace regalos sentimentales también hace jingles, roasts, himnos
            y drops. Este laboratorio muestra 16 líneas nuevas en 4 familias — con demos reales
            generados hoy por el pipeline de producción.
          </p>
          <div className="flex flex-wrap justify-center gap-3 text-sm">
            <span className="bg-white/5 border border-white/10 rounded-full px-4 py-2 text-white/80">🎵 {demoCount || 7} demos reales</span>
            <span className="bg-white/5 border border-white/10 rounded-full px-4 py-2 text-white/80">💼 Nueva licencia comercial</span>
            <span className="bg-white/5 border border-white/10 rounded-full px-4 py-2 text-white/80">🚫 No enlazado · noindex</span>
          </div>
        </div>
      </section>

      {/* Groups */}
      <main className="max-w-6xl mx-auto px-6 pb-20">
        {GROUPS.map(group => (
          <section key={group.id} className="mb-14">
            <div className="mb-6">
              <h2 className="font-display text-2xl md:text-3xl font-bold mb-2">
                {group.emoji} {group.title}
              </h2>
              <p className="text-white/60 max-w-3xl leading-relaxed">{group.blurb}</p>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              {group.items.map(item => (
                <article key={item.key} className="bg-card/60 border border-white/10 rounded-2xl p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span className="text-2xl">{item.emoji}</span> {item.name}
                    </h3>
                    <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider rounded-full px-2.5 py-1 border ${
                      item.tag === 'DEMO REAL'
                        ? 'text-turquesa border-turquesa/40 bg-turquesa/10'
                        : 'text-white/50 border-white/15 bg-white/5'
                    }`}>
                      {item.tag}
                    </span>
                  </div>
                  <p className="text-white/75 text-sm leading-relaxed">{item.pitch}</p>
                  {item.demoKey && demosWithKeys[item.demoKey] && (
                    <DemoPlayer demo={demosWithKeys[item.demoKey]} playingKey={playingKey} onToggle={togglePlay} />
                  )}
                  <div className="mt-auto pt-2 grid gap-1.5 text-xs text-white/55 border-t border-white/5">
                    <span><span className="text-white/40 uppercase tracking-wide font-semibold">Comprador · </span>{item.buyer}</span>
                    <span><span className="text-white/40 uppercase tracking-wide font-semibold">Funnel · </span>{item.funnel}</span>
                    <span className="text-marigold font-bold text-sm pt-1">{item.price} <span className="text-white/40 font-normal">precio sugerido</span></span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}

        {/* License tiers */}
        <section className="mb-14">
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-2">📜 La pieza clave: Licencia Comercial</h2>
          <p className="text-white/60 max-w-3xl leading-relaxed mb-6">
            Generar la canción cuesta lo mismo; el <em>permiso de uso</em> es lo que cambia de precio.
            Un nivel comercial convierte cada línea B2B en margen casi puro y no toca el producto personal actual.
          </p>
          <div className="grid md:grid-cols-3 gap-5">
            {LICENSE_TIERS.map(tier => (
              <div key={tier.name} className={`rounded-2xl border-2 ${tier.color} bg-card/60 p-6 ${tier.featured ? 'md:-translate-y-2 shadow-2xl shadow-turquesa/10' : ''}`}>
                {tier.featured && <div className="text-turquesa text-[10px] font-bold uppercase tracking-widest mb-2">★ El margen vive aquí</div>}
                <h3 className="text-xl font-bold">{tier.name}</h3>
                <div className="text-3xl font-black text-marigold my-2">{tier.price}</div>
                <p className="text-white/65 text-sm leading-relaxed mb-4">{tier.desc}</p>
                <ul className="space-y-1.5 text-sm text-white/75">
                  {tier.bullets.map(b => <li key={b}>✓ {b}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Roadmap */}
        <section className="mb-14">
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-6">🗺️ Orden de lanzamiento propuesto</h2>
          <div className="grid md:grid-cols-3 gap-5">
            {ROADMAP.map(step => (
              <div key={step.phase} className="bg-card/60 border border-white/10 rounded-2xl p-6">
                <div className="w-10 h-10 rounded-full bg-turquesa text-black font-black flex items-center justify-center text-lg mb-3">{step.phase}</div>
                <h3 className="font-bold text-lg mb-2">{step.title}</h3>
                <p className="text-white/65 text-sm leading-relaxed">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How the demos were made */}
        <section className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 text-sm text-white/60 leading-relaxed">
          <h2 className="font-bold text-white text-base mb-2">🔬 Cómo se hicieron los demos</h2>
          <p>
            Los 7 demos marcados como <span className="text-turquesa font-semibold">DEMO REAL</span> se generaron
            el 29 de agosto de 2026 a través del endpoint <code className="text-white/80">generate-song</code> de
            producción (correo <code className="text-white/80">trends-demo@regalosquecantan.com</code>), sin ningún
            cambio al backend: solo prompts distintos. Es exactamente lo que recibiría un cliente de cada línea,
            con sus dos tomas cada uno. El audio ya está rehosteado en el bucket público de Supabase Storage;
            antes de lanzar un funnel, copiar los keepers a <code className="text-white/80">public/samples/trends/</code>
            {' '}para que las muestras no dependan de filas de canciones sin pagar.
          </p>
        </section>
      </main>

      <footer className="border-t border-white/5 py-8 text-center text-white/40 text-xs">
        Trends Lab · página interna · nada de esto está a la venta todavía
      </footer>
    </div>
  );
}
