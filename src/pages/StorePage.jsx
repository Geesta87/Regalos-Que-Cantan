import React, { useContext, useEffect, useState } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';
import { createPackCheckout } from '../services/api';
import { Media, CSS, FEATURES } from '../components/OneTapUpsell';

// ─────────────────────────────────────────────────────────────────────────────
// StorePage (/tienda) — e-commerce catalog of EVERYTHING we sell: the song
// itself (single + 2-pack) plus every upsell (animado, video con fotos, video
// con letra, pista instrumental, enviar por mensaje). Each product is its own
// box, ecommerce-grid style. Previews reuse the EXACT components shown at
// checkout (OneTapUpsell <Media/>) so what the buyer sees here is what they get.
// All extras attach to a song, so every CTA funnels into "crear mi canción".
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = '#f20d80';
// "Próximamente" products capture interest via WhatsApp until fulfillment ships.
const waLink = (title) => `https://wa.me/18183065193?text=${encodeURIComponent(`¡Hola! Me interesa "${title}" de la tienda 🎵 ¿me avisan cuando esté disponible?`)}`;

// ── Custom previews for the song-variant + karaoke upsells (no checkout
// component exists for these yet, so the store renders its own brand-matched
// preview). They reuse the otuWave / otuLyric keyframes from OneTapUpsell CSS,
// already injected at the top of StorePage. All sized 200px tall to line up
// with the imported <Media/> boxes. ──
function StyleSwapMedia() {
  return (
    <div className="relative h-[200px] overflow-hidden" style={{ background: 'linear-gradient(135deg,#2a1320,#15101c)' }}>
      <span className="absolute top-2 left-2 z-10 text-[9px] font-bold tracking-wider text-white/60">🎚️ MISMO RELATO · OTRO ESTILO</span>
      <div className="absolute inset-0 flex items-center justify-center gap-2.5">
        <div className="relative w-[84px] -rotate-6">
          <img src="/images/album-art/banda.jpg" alt="" className="w-full aspect-square object-cover rounded-lg shadow-xl border border-white/10" loading="lazy" />
          <span className="absolute -bottom-1 left-0 right-0 text-center text-[10px] font-bold text-white drop-shadow">Banda</span>
        </div>
        <div className="w-9 h-9 rounded-full bg-landing-primary/90 flex items-center justify-center text-white text-lg shadow-lg shrink-0">↻</div>
        <div className="relative w-[84px] rotate-6">
          <img src="/images/album-art/bachata.jpg" alt="" className="w-full aspect-square object-cover rounded-lg shadow-xl border border-white/10" loading="lazy" />
          <span className="absolute -bottom-1 left-0 right-0 text-center text-[10px] font-bold text-white drop-shadow">Bachata</span>
        </div>
      </div>
    </div>
  );
}

function VoiceSwapMedia() {
  const bars = [14, 22, 30, 18, 26, 32, 20, 12, 28, 22, 30, 16];
  return (
    <div className="relative h-[200px] flex flex-col items-center justify-center gap-3" style={{ background: 'linear-gradient(135deg,#241d2e,#15101c)' }}>
      <span className="absolute top-2 left-2 text-[9px] font-bold tracking-wider text-white/60">🎙️ LA MISMA CANCIÓN · OTRA VOZ</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-xl">👨</div>
          <span className="text-[10px] font-bold text-white/50">Voz él</span>
        </div>
        <div className="flex items-end gap-[3px] h-9">
          {bars.map((h, i) => (
            <span key={i} style={{ width: 5, height: h, borderRadius: 2, background: i % 2 ? GOLD : 'rgba(255,255,255,0.5)', transformOrigin: 'center', animation: `otuWave 0.9s ease-in-out infinite ${(i % 5) * 0.12}s` }} />
          ))}
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl" style={{ background: 'rgba(242,13,128,0.18)', border: '1px solid rgba(242,13,128,0.5)' }}>👩</div>
          <span className="text-[10px] font-bold" style={{ color: GOLD }}>Voz ella</span>
        </div>
      </div>
      <span className="text-[10.5px] font-semibold text-white/45">…o a dúo, los dos juntos</span>
    </div>
  );
}

function KaraokeMedia() {
  const lines = ['Desde el día que llegaste', 'todo cambió para bien', 'y hoy te canto esta canción'];
  return (
    <div className="relative h-[200px] flex items-center justify-center overflow-hidden" style={{ background: 'linear-gradient(135deg,#13243a,#0c1422)' }}>
      <span className="absolute top-2 left-2 text-[9px] font-bold tracking-wider text-white/60">🎤 MODO KARAOKE</span>
      <span className="absolute top-2 right-2 text-[9px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: 'rgba(242,13,128,0.85)' }}>sin voz</span>
      <div className="relative w-full h-6 text-center">
        {lines.map((l, i) => (
          <span key={i} className="absolute left-2 right-2 text-[13px] font-bold text-white" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.6)', opacity: 0, animation: `otuLyric 6s ease-in-out ${i * 2}s infinite` }}>{l}</span>
        ))}
      </div>
      <div className="absolute bottom-3 left-0 right-0 flex items-end justify-center gap-[3px] h-6 opacity-60">
        {[10, 16, 22, 13, 20, 26, 15, 11, 23, 17].map((h, i) => (
          <span key={i} style={{ width: 4, height: h, borderRadius: 2, background: 'rgba(255,255,255,0.4)', transformOrigin: 'center', animation: `otuWave 0.9s ease-in-out infinite ${(i % 5) * 0.12}s` }} />
        ))}
      </div>
    </div>
  );
}

// kind:'song' renders the song hero card; kind:'extra' renders an upsell card
// with the real checkout preview. cat drives the category filter tabs.
const PRODUCTS = [
  {
    kind: 'song', cat: 'cancion', key: 'single', title: 'Canción personalizada',
    sub: 'Una canción única, hecha a la medida de tu historia',
    was: 59.99, price: 29.99, badge: 'Preview gratis', art: '/images/album-art/mariachi.jpg',
    desc: 'Tú nos cuentas la historia y el género; nosotros creamos una canción original con su nombre, lista en ~3 minutos. Escucha un preview gratis antes de pagar.',
    bullets: ['Letra original con su nombre y su historia', 'El género que elijas (corrido, banda, bachata…)', 'Lista en ~3 minutos · preview gratis', 'Descárgala y compártela por WhatsApp'],
  },
  {
    kind: 'song', cat: 'cancion', key: 'bundle', title: 'Paquete de 2 canciones',
    sub: 'Dos canciones — regala más y ahorra',
    was: 69.98, price: 39.99, badge: 'Más popular', art: '/images/album-art/bachata.jpg',
    desc: 'Dos canciones personalizadas por menos. Perfecto para regalar a dos personas, o para tener dos versiones (dos géneros, dos voces) de la misma historia.',
    bullets: ['Dos canciones personalizadas completas', 'Dos géneros o dos versiones distintas', 'Ahorra frente a comprarlas por separado', 'Ambas listas en minutos · preview gratis'],
  },
  {
    kind: 'song', cat: 'cancion', key: 'triple', title: 'Paquete de 3 canciones', pack: true,
    sub: 'Tres canciones — el mejor precio por canción',
    was: 89.97, price: 49.99, badge: 'Mejor valor', art: '/images/album-art/cumbia.jpg',
    desc: 'Pagas una vez y recibes un código personal para crear 3 canciones — una para cada persona, cuando tú quieras. Diferente género, nombre e historia en cada una.',
    bullets: ['Tres canciones personalizadas completas', 'Una para cada persona (género e historia distintos)', 'El precio más bajo por canción', 'Tu código llega al correo · 12 meses para usarlo'],
  },
  {
    kind: 'extra', cat: 'cancion', key: 'otro_estilo', title: 'La misma historia, otro estilo', soon: true,
    sub: 'Tu misma canción, en un género nuevo', price: 14.99,
    customMedia: StyleSwapMedia,
    bullets: ['La misma letra y la misma historia', 'En el género que tú elijas (banda, bachata, corrido…)', 'Una segunda versión para sorprender de otra forma'],
  },
  {
    kind: 'extra', cat: 'cancion', key: 'otra_voz', title: 'En otra voz', soon: true,
    sub: 'La misma canción, cantada por otra voz', price: 9.99,
    customMedia: VoiceSwapMedia,
    bullets: ['Voz masculina, femenina… o a dúo, los dos juntos', 'La misma letra y la misma melodía', 'Perfecta para regalar a dos personas a la vez'],
  },
  {
    kind: 'extra', cat: 'video', key: 'animado', title: 'Película animada',
    sub: 'Su rostro convertido en personaje animado', price: 29,
    media: { type: 'video', src: '/animado-sample.mp4', pos: 'center 18%' },
  },
  {
    kind: 'extra', cat: 'video', key: 'video', title: 'Video con fotos',
    sub: 'Sus fotos hechas película, con la canción', price: 9.99,
    media: { type: 'photos' },
  },
  {
    kind: 'extra', cat: 'video', key: 'lyric_video', title: 'Video con letra',
    sub: 'La letra en pantalla, al ritmo de la música', price: 9.99,
    media: { type: 'lyrics' },
  },
  {
    kind: 'extra', cat: 'video', key: 'video_karaoke', title: 'Video Karaoke', soon: true,
    sub: 'Sin voz + la letra en pantalla para cantar', price: 12.99,
    customMedia: KaraokeMedia,
    bullets: ['La música sin la voz, lista para cantar', 'La letra aparece al ritmo, palabra por palabra', 'Listo para fiestas, karaoke y redes'],
  },
  {
    kind: 'extra', cat: 'extra', key: 'instrumental', title: 'Pista instrumental',
    sub: 'La misma canción, solo la música — para cantar', price: 7.99,
    media: { type: 'ab' },
  },
  {
    kind: 'extra', cat: 'extra', key: 'gift', title: 'Enviar por mensaje',
    sub: 'Se la enviamos el día y la hora que elijas', price: 5,
    media: { type: 'video', src: '/sms-reaction.mp4' },
  },
];

const CATS = [
  { id: 'all', label: 'Todo' },
  { id: 'cancion', label: 'Canciones' },
  { id: 'video', label: 'Videos' },
  { id: 'extra', label: 'Extras' },
];

function FeatureBullets({ items }) {
  return (
    <ul className="mt-4 space-y-2">
      {items.map((f, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-slate-300 leading-snug">
          <span className="text-green-400 font-bold mt-0.5 shrink-0">✓</span>
          {f}
        </li>
      ))}
    </ul>
  );
}

// Song product — large card leading with the price and a "crear" CTA.
function SongCard({ p, onAct }) {
  return (
    <div className="group relative flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden transition-all hover:border-landing-primary/50 hover:-translate-y-1 hover:shadow-2xl hover:shadow-landing-primary/10">
      {(p.soon || p.badge) && (
        <span className={`absolute top-3 right-3 z-10 text-[11px] font-extrabold px-3 py-1 rounded-full shadow-lg ${p.soon ? 'bg-amber-400 text-amber-950' : 'bg-landing-primary text-white'}`}>
          {p.soon ? 'Próximamente' : p.badge}
        </span>
      )}
      <div className="relative h-44 overflow-hidden bg-slate-900">
        <img src={p.art} alt={p.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-landing-bg via-landing-bg/30 to-transparent" />
        <div className="absolute bottom-3 left-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-landing-primary text-3xl drop-shadow-lg" style={{ fontVariationSettings: "'FILL' 1" }}>graphic_eq</span>
          <span className="text-white/90 text-xs font-bold uppercase tracking-widest">La canción</span>
        </div>
      </div>
      <div className="flex flex-col flex-1 p-5">
        <h3 className="text-white text-lg font-extrabold leading-tight">{p.title}</h3>
        <p className="text-slate-400 text-sm mt-1">{p.sub}</p>
        <p className="text-slate-400 text-sm mt-3 leading-relaxed">{p.desc}</p>
        <FeatureBullets items={p.bullets} />
        <div className="flex-1" />
        <div className="mt-5 flex items-end gap-2">
          {p.was && <span className="text-white/30 line-through text-base">${p.was}</span>}
          <span className="text-landing-primary text-3xl font-extrabold leading-none">${p.price}</span>
        </div>
        {p.soon ? (
          <button
            onClick={onAct}
            className="mt-4 w-full bg-white/8 hover:bg-white/15 border border-amber-400/40 hover:border-amber-400/70 text-amber-300 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            🔔 Avísame cuando esté listo
          </button>
        ) : (
          <button
            onClick={onAct}
            className="mt-4 w-full bg-landing-primary hover:bg-landing-primary/90 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-landing-primary/25 flex items-center justify-center gap-2 group/btn"
          >
            {p.pack ? `🎁 Comprar paquete · $${p.price}` : '🎵 Crear mi canción'}
            <span className="material-symbols-outlined text-xl transition-transform group-hover/btn:translate-x-1">arrow_forward</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Upsell product — reuses the exact checkout preview (<Media/>) at the top.
function ExtraCard({ p, onAct }) {
  const Custom = p.customMedia;
  return (
    <div className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden transition-all hover:border-landing-primary/50 hover:-translate-y-1 hover:shadow-2xl hover:shadow-landing-primary/10">
      <div className="relative">
        {Custom ? <Custom /> : <Media media={p.media} />}
        <span className={`absolute top-2 right-2 z-10 text-[10px] font-bold px-2.5 py-1 rounded-full ${p.soon ? 'bg-amber-400 text-amber-950' : 'bg-black/55 text-white'}`}>
          {p.soon ? 'Próximamente' : 'Complemento'}
        </span>
      </div>
      <div className="flex flex-col flex-1 p-5">
        <h3 className="text-white text-base font-extrabold leading-tight">{p.title}</h3>
        <p className="text-slate-400 text-sm mt-1">{p.sub}</p>
        <FeatureBullets items={p.bullets || (FEATURES[p.key] || []).slice(0, 3)} />
        <div className="flex-1" />
        <div className="mt-5 flex items-center justify-between">
          <span className="text-landing-primary text-2xl font-extrabold leading-none">${p.price}</span>
          <span className="text-slate-500 text-[11px] font-semibold">{p.soon ? 'Muy pronto' : 'Se agrega a tu canción'}</span>
        </div>
        {p.soon ? (
          <button
            onClick={onAct}
            className="mt-3 w-full bg-white/8 hover:bg-white/15 border border-amber-400/40 hover:border-amber-400/70 text-amber-300 font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            🔔 Avísame · WhatsApp
          </button>
        ) : (
          <button
            onClick={onAct}
            className="mt-3 w-full bg-white/8 hover:bg-white/15 border border-white/15 hover:border-landing-primary/50 text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            + Agregar a mi canción
          </button>
        )}
      </div>
    </div>
  );
}

// Two-door chooser shown when a buyable extra is tapped: attach it to a NEW
// song (pre-ticked at checkout) or to one they ALREADY have (/mi-cancion).
function DoorModal({ product, onClose, onNewSong, onHaveSong }) {
  if (!product) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-white/12 p-6 shadow-2xl" style={{ background: '#1c141a', animation: 'otuIn .22s ease-out both' }}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-white text-lg font-extrabold leading-tight">{product.title}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none shrink-0">✕</button>
        </div>
        <p className="text-slate-400 text-sm">{product.sub} · <span className="text-landing-primary font-extrabold">${product.price}</span></p>
        <p className="text-slate-300 text-sm mt-4 mb-4">Este complemento se suma a una canción. ¿Cómo quieres agregarlo?</p>
        <button onClick={onNewSong} className="w-full bg-landing-primary hover:bg-landing-primary/90 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-landing-primary/25 flex items-center justify-center gap-2">
          🎵 Es para una canción nueva
        </button>
        <p className="text-slate-500 text-[11px] text-center mt-1.5 mb-3">Creas tu canción y lo agregas al pagar — un solo pago</p>
        <button onClick={onHaveSong} className="w-full bg-white/8 hover:bg-white/15 border border-white/15 hover:border-landing-primary/50 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2">
          ✅ Ya tengo mi canción
        </button>
        <p className="text-slate-500 text-[11px] text-center mt-1.5">Encuentra tu canción por correo y agrégalo desde ahí</p>
      </div>
    </div>
  );
}

// Buy flow for the 3-song pack: collect name + email, then Stripe. The webhook
// mints + emails the personal NOMBRE-### code on payment.
function PackModal({ open, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!open) return null;

  const submit = async () => {
    setErr('');
    if (!name.trim()) return setErr('Escribe tu nombre (así personalizamos tu código).');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setErr('Escribe un correo válido — ahí te enviamos el código.');
    setBusy(true);
    try {
      const { url } = await createPackCheckout(name.trim(), email.trim());
      if (!url) throw new Error('No se pudo iniciar el pago.');
      window.location.href = url;
    } catch (e) {
      setErr(e.message || 'No se pudo iniciar el pago. Intenta de nuevo.');
      setBusy(false);
    }
  };

  const inp = 'w-full box-border px-3.5 py-3 rounded-xl bg-black/30 border border-white/15 text-white placeholder-white/35 outline-none focus:border-landing-primary/60 text-[15px]';

  return (
    <div onClick={onClose} className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-white/12 p-6 shadow-2xl" style={{ background: '#1c141a', animation: 'otuIn .22s ease-out both' }}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-white text-lg font-extrabold leading-tight">Paquete de 3 Canciones</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none shrink-0">✕</button>
        </div>
        <p className="text-slate-400 text-sm">Un solo pago de <span className="text-landing-primary font-extrabold">$49.99</span> · código para 3 canciones, una por persona.</p>
        <p className="text-slate-300 text-sm mt-4 mb-3">Te enviamos tu código personal por correo — lo usas cuando quieras (12 meses).</p>
        <input className={inp + ' mb-2.5'} placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inp} type="email" placeholder="Tu correo" value={email} onChange={(e) => setEmail(e.target.value)} />
        {err && <p className="text-[#f3a0a0] text-[12.5px] mt-2.5">{err}</p>}
        <button onClick={submit} disabled={busy} className="mt-4 w-full bg-landing-primary hover:bg-landing-primary/90 disabled:opacity-70 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-landing-primary/25 flex items-center justify-center gap-2">
          {busy ? 'Abriendo el pago…' : '🎁 Pagar $49.99 y recibir mi código'}
        </button>
        <p className="text-slate-500 text-[11px] text-center mt-2.5">🔒 Pago seguro con Stripe · tu código llega al instante</p>
      </div>
    </div>
  );
}

export default function StorePage() {
  const { navigateTo } = useContext(AppContext);
  const [cat, setCat] = useState('all');
  const [doorProduct, setDoorProduct] = useState(null); // extra awaiting the two-door choice
  const [packOpen, setPackOpen] = useState(false); // 3-song pack buy modal

  useEffect(() => { trackStep('store'); }, []);

  const start = () => navigateTo('genre');
  const visible = PRODUCTS.filter((p) => cat === 'all' || p.cat === cat);

  // Door 1: stash the chosen extra so /comparison pre-ticks it, then funnel.
  const doorNewSong = () => {
    try { if (doorProduct) sessionStorage.setItem('rqc_preselect_extra', doorProduct.key); } catch { /* ignore */ }
    setDoorProduct(null);
    navigateTo('genre');
  };
  // Door 2: send them to find a song they already have.
  const doorHaveSong = () => { setDoorProduct(null); navigateTo('recoverSong'); };

  // What a card's button does: "soon" → WhatsApp; pack → buy modal;
  // song → funnel; extra → two-door.
  const actFor = (p) => {
    if (p.soon) return () => window.open(waLink(p.title), '_blank');
    if (p.pack) return () => setPackOpen(true);
    if (p.kind === 'song') return start;
    return () => setDoorProduct(p);
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-landing-bg text-white antialiased overflow-x-hidden">
      <style>{CSS}</style>

      {/* ─── Fixed Top Navbar (matches landing) ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between border-b border-white/10 bg-landing-bg/80 backdrop-blur-md px-6 py-4 lg:px-20">
        <button onClick={() => navigateTo('landing')} className="flex items-center gap-2 text-landing-primary hover:opacity-90 transition-opacity">
          <span className="material-symbols-outlined text-3xl">library_music</span>
          <h2 className="text-white text-xl font-extrabold tracking-tight">RegalosQueCantan</h2>
        </button>
        <div className="flex items-center gap-2 md:gap-4">
          <button
            onClick={() => navigateTo('recoverSong')}
            className="hidden sm:inline-flex items-center gap-1.5 bg-white/8 hover:bg-white/15 border border-white/15 hover:border-white/30 text-white text-xs md:text-sm font-semibold px-3 py-2 md:px-4 md:py-2.5 rounded-lg transition-all"
          >
            <span aria-hidden="true">🎵</span>
            <span>Mi canción</span>
          </button>
          <button
            onClick={start}
            className="bg-landing-primary hover:bg-landing-primary/90 text-white text-sm font-bold px-5 py-2.5 md:px-6 rounded-lg transition-all shadow-lg shadow-landing-primary/25"
          >
            Empezar
          </button>
        </div>
      </header>

      <main className="flex-1 pt-28 pb-16 px-6 lg:px-20">
        <div className="max-w-6xl mx-auto">
          {/* ─── Header ─── */}
          <div className="text-center mb-10">
            <span className="text-landing-primary text-sm font-bold uppercase tracking-widest">Tienda</span>
            <h1 className="text-white text-4xl md:text-5xl font-extrabold mt-3 tracking-tight">
              Todo lo que puedes <span className="text-landing-primary">regalar</span>
            </h1>
            <p className="text-slate-400 text-lg mt-4 max-w-2xl mx-auto">
              La canción personalizada y todos los complementos para hacerla aún más especial — en un solo lugar.
            </p>
          </div>

          {/* ─── Category filter tabs ─── */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {CATS.map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`px-5 py-2 rounded-full text-sm font-bold transition-all border ${
                  cat === c.id
                    ? 'bg-landing-primary text-white border-landing-primary shadow-lg shadow-landing-primary/25'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* ─── Product grid ─── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
            {visible.map((p) =>
              p.kind === 'song'
                ? <SongCard key={p.key} p={p} onAct={actFor(p)} />
                : <ExtraCard key={p.key} p={p} onAct={actFor(p)} />
            )}
          </div>

          {/* ─── Reassurance row ─── */}
          <div className="mt-14 flex flex-col sm:flex-row flex-wrap justify-center gap-8 opacity-70">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-landing-primary">verified_user</span>
              <span className="text-sm font-medium">Pago seguro</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-landing-primary">speed</span>
              <span className="text-sm font-medium">Canción lista en ~3 min</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-landing-primary">favorite</span>
              <span className="text-sm font-medium">+5000 clientes felices</span>
            </div>
          </div>

          {/* ─── Closing CTA ─── */}
          <div className="mt-12 text-center">
            <button
              onClick={start}
              className="min-w-[220px] bg-landing-primary hover:bg-landing-primary/90 text-white text-lg font-bold px-8 py-4 rounded-xl transition-all shadow-xl shadow-landing-primary/20 inline-flex items-center justify-center gap-2 group"
            >
              🎵 Empezar mi canción
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
            </button>
            <p className="text-slate-500 text-xs mt-4">Los complementos se agregan al finalizar tu canción · preview gratis antes de pagar</p>
          </div>
        </div>
      </main>

      {/* ─── Footer ─── */}
      <footer className="relative z-30 bg-landing-bg border-t border-white/5 py-8 px-6 lg:px-20 flex flex-col md:flex-row justify-between items-center gap-4">
        <p className="text-slate-500 text-sm">© 2026 RegalosQueCantan · Hecho con ❤️</p>
        <div className="flex flex-wrap items-center justify-center gap-5">
          <a
            className="text-slate-300 hover:text-landing-primary transition-colors text-xs font-semibold inline-flex items-center gap-1"
            href="/mi-cancion"
            onClick={(e) => { e.preventDefault(); navigateTo('recoverSong'); }}
          >
            🎵 Recuperar mi canción
          </a>
          <a className="text-slate-500 hover:text-landing-primary transition-colors text-xs" href="mailto:hola@regalosquecantan.com">Contacto</a>
        </div>
      </footer>

      <DoorModal product={doorProduct} onClose={() => setDoorProduct(null)} onNewSong={doorNewSong} onHaveSong={doorHaveSong} />
      <PackModal open={packOpen} onClose={() => setPackOpen(false)} />
    </div>
  );
}
