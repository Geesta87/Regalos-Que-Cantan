import React, { useState, useRef, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Animado — customer-facing UI for the animated story-video upsell.
//
// Two screens the customer sees:
//   1) <AnimadoOffer/>        — the pitch + price + "Agregar" toggle (lives on the
//                               comparison / upsell page next to the $9.99 slideshow).
//   2) <AnimadoPhotoUpload/>  — the post-purchase step asking for a clear photo of
//                               the recipient, which feeds the likeness pipeline.
//
// Default export <AnimadoUpsell/> is a LOCAL DEMO page that shows both with a toggle,
// so we can preview the experience before wiring it into the real funnel.
//
// PRICE is a single constant — change it here to retune the offer.
// ─────────────────────────────────────────────────────────────────────────────

const PRICE = 29;          // beta price — 1 animated video
const PRICE_BOTH = 44.99;  // both songs animated (bundle) — saves vs 2×$29
const ANCHOR = 99;         // slashed "regular" anchor (per video)

const GOLD = '#f5b942';
const PINK = '#f74da6';
const VIOLET = '#a855f7';

// ── The two character styles the customer chooses between (one or the other). ──
// Each `img` is a real example produced by our pipeline so they see exactly what
// they'll get. `key` is what we persist on the order and feed to the likeness step.
const STYLES = [
  {
    key: 'pixar',
    emoji: '🎬',
    label: 'Estilo Pixar',
    sub: 'Personaje 3D animado — expresivo y mágico, como una película de Disney·Pixar.',
    img: 'https://yzbvajungshqcpusfiia.supabase.co/storage/v1/object/public/story-video-assets/c84ba8ed-cfe1-4e71-a9da-94a2f686e8a9/source-style01.jpg',
  },
  {
    key: 'likeness',
    emoji: '🪄',
    label: 'Caricatura fiel',
    sub: 'Animado, pero idéntico a su rostro real — el máximo parecido posible.',
    img: 'https://yzbvajungshqcpusfiia.supabase.co/storage/v1/object/public/story-video-assets/c84ba8ed-cfe1-4e71-a9da-94a2f686e8a9/source-faithfullook.png',
  },
];

// Shared keyframes (magical morph + scene reel + shimmer)
const ANIM_CSS = `
  @keyframes aniFade { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes aniMorph { 0%, 42% { opacity: 1; } 58%, 100% { opacity: 0; } }
  @keyframes aniMorphIn { 0%, 42% { opacity: 0; } 58%, 100% { opacity: 1; } }
  @keyframes aniShimmer { 0% { left: -60%; } 100% { left: 160%; } }
  @keyframes aniFloat { 0%, 100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-7px) rotate(4deg); } }
  @keyframes aniPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
  @keyframes aniGlow { 0%, 100% { box-shadow: 0 0 0 2px rgba(245,185,66,0.45), 0 0 26px rgba(245,185,66,0.25); } 50% { box-shadow: 0 0 0 4px rgba(245,185,66,0.55), 0 0 50px rgba(247,77,166,0.45); } }
  @keyframes scene1 { 0%,20%{opacity:1} 28%,100%{opacity:0} }
  @keyframes scene2 { 0%,20%{opacity:0} 28%,45%{opacity:1} 53%,100%{opacity:0} }
  @keyframes scene3 { 0%,45%{opacity:0} 53%,70%{opacity:1} 78%,100%{opacity:0} }
  @keyframes scene4 { 0%,70%{opacity:0} 78%,95%{opacity:1} 100%{opacity:0} }
`;

// ── Real animated-video preview (a 30s teaser cut from a real produced video).
//    Autoplays muted + looping (motion catches the eye); tap to hear the song. ──
const SAMPLE_SRC = '/animado-sample.mp4';
const SAMPLE_POSTER = '/animado-sample-poster.jpg';

function VideoHero() {
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(true);
  const [started, setStarted] = useState(false);

  const toggleSound = () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
    if (!next) { v.play().catch(() => {}); } // unmute implies the user wants to hear it
  };

  return (
    <div style={{
      position: 'relative', width: '100%', maxWidth: 268, margin: '0 auto',
      borderRadius: 20, overflow: 'hidden', background: '#0d0a12',
      border: '3px solid rgba(245,185,66,0.55)',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 14px 40px rgba(247,77,166,0.28)',
      animation: 'aniGlow 3s ease-in-out infinite',
    }}>
      <video
        ref={videoRef}
        src={SAMPLE_SRC}
        poster={SAMPLE_POSTER}
        muted={muted}
        loop
        playsInline
        autoPlay
        onPlay={() => setStarted(true)}
        onClick={toggleSound}
        style={{ display: 'block', width: '100%', aspectRatio: '9/16', objectFit: 'cover', cursor: 'pointer' }}
      />
      {/* "real sample" badge */}
      <div style={{
        position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        padding: '4px 10px', borderRadius: 20, fontSize: 11, color: '#fff', fontWeight: 800,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
        Muestra real
      </div>
      {/* sound toggle */}
      <button onClick={toggleSound} style={{
        position: 'absolute', bottom: 10, right: 10, border: 'none', cursor: 'pointer',
        background: muted ? 'rgba(247,77,166,0.92)' : 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        color: '#fff', fontSize: 12, fontWeight: 800, padding: '7px 12px', borderRadius: 20,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {muted ? '🔇 Toca para oír' : '🔊 Con sonido'}
      </button>
      {/* caption strip */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, padding: '26px 110px 11px 12px',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
        fontSize: 11, color: 'rgba(255,255,255,0.92)', fontWeight: 700, textAlign: 'left',
        lineHeight: 1.3, pointerEvents: 'none',
      }}>
        🎨 Ilustraciones animadas + 🎬 movimiento
      </div>
    </div>
  );
}

// ── Style chooser: two example faces, pick one (Pixar or faithful caricature). ──
function StylePicker({ value, onChange }) {
  return (
    <div style={{
      margin: '16px 0', background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 14,
    }}>
      <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 800, color: '#fff' }}>
        🎨 Elige el estilo del personaje
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 11.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
        Tú decides cómo se ve. Ambos se animan con la misma historia y movimiento.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {STYLES.map((s) => {
          const on = value === s.key;
          return (
            <button key={s.key} onClick={() => onChange(s.key)} style={{
              position: 'relative', padding: 0, cursor: 'pointer', textAlign: 'left',
              borderRadius: 14, overflow: 'hidden', background: 'rgba(0,0,0,0.3)',
              border: on ? `2.5px solid ${GOLD}` : '2.5px solid rgba(255,255,255,0.1)',
              boxShadow: on ? '0 0 0 1px rgba(245,185,66,0.4), 0 8px 22px rgba(245,185,66,0.22)' : 'none',
              transition: 'all 0.2s',
            }}>
              <div style={{ position: 'relative' }}>
                <img src={s.img} alt={s.label}
                  style={{ display: 'block', width: '100%', aspectRatio: '3/4', objectFit: 'cover' }} />
                {/* selected check */}
                {on && (
                  <span style={{
                    position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: '50%',
                    background: GOLD, color: '#1a1020', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 15, fontWeight: 900,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  }}>✓</span>
                )}
                {/* "example" tag */}
                <span style={{
                  position: 'absolute', top: 8, left: 8, fontSize: 9.5, fontWeight: 800, color: '#fff',
                  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', padding: '3px 7px', borderRadius: 20,
                }}>Ejemplo</span>
              </div>
              <div style={{ padding: '9px 10px 11px' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: on ? GOLD : '#fff' }}>
                  {s.emoji} {s.label}
                </p>
                <p style={{ margin: '3px 0 0', fontSize: 10.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.35 }}>
                  {s.sub}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCREEN 1 — THE OFFER
// ═══════════════════════════════════════════════════════════════════════════
export function AnimadoOffer({
  recipientName = 'Papá',
  songs = [{ id: 's1', version: 1 }],
  count = 0,                 // 0 = none, 1 = one video, 2 = both songs
  selectedVideoSongId = null, // which song gets the video when count === 1
  selectedStyle = 'pixar',   // 'pixar' | 'likeness'
  onStyleChange = () => {},   // (styleKey) => void
  enableStylePicker = false,  // only show the style chooser when the caller actually
                              // wires it (demo). The live funnel leaves it off until
                              // the style is plumbed into checkout + the backend.
  onChange = () => {},        // (count, selectedVideoSongId) => void
}) {
  const isTwo = songs.length >= 2;
  const added = count > 0;
  const price = count === 2 ? PRICE_BOTH : count === 1 ? PRICE : 0;
  const verLabel = (s) => `Versión ${s.version || 1}`;
  const chosenSongId = selectedVideoSongId || songs[0]?.id;
  const styleLabel = (STYLES.find((s) => s.key === selectedStyle) || STYLES[0]).label;
  const features = [
    { icon: '🎨', label: 'Su rostro convertido en personaje animado', sub: 'En el estilo que elijas, fiel a su cara — a partir de una foto suya' },
    { icon: '🖼️', label: 'Bellas ilustraciones de su historia', sub: 'Cada escena, ilustrada a mano a partir de SU canción' },
    { icon: '🎬', label: 'Movimiento en las escenas clave', sub: 'Los momentos más especiales cobran vida con movimiento real' },
    { icon: '✨', label: 'Intro mágica: su foto “cobra vida”', sub: 'Su foto real se transforma en el personaje animado' },
    { icon: '🎵', label: 'Sincronizado con la letra', sub: 'Cada escena aparece justo cuando se canta' },
    { icon: '📲', label: 'Video HD listo para compartir', sub: 'Perfecto para WhatsApp, redes o proyectar en la fiesta' },
  ];
  return (
    <div style={{
      background: 'linear-gradient(160deg, #1a1020 0%, #140d18 100%)',
      border: added ? `2px solid #22c55e` : `2px solid rgba(245,185,66,0.55)`,
      borderRadius: 20, padding: 20, position: 'relative', overflow: 'hidden',
      boxShadow: added ? '0 0 26px rgba(34,197,94,0.3)' : '0 10px 40px rgba(247,77,166,0.18)',
      animation: 'aniFade 0.6s ease-out both',
    }}>
      <style>{ANIM_CSS}</style>

      {/* Ribbon — upsell framing */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: `linear-gradient(135deg, ${GOLD}, ${PINK})`,
        color: '#1a1020', fontWeight: 900, fontSize: 11, letterSpacing: '1px',
        padding: '5px 12px', borderRadius: 20, marginBottom: 14, textTransform: 'uppercase',
      }}>⭐ Hazlo inolvidable · Suma a tu pedido</div>

      {/* Headline */}
      <h2 style={{ margin: '0 0 6px', fontSize: 25, fontWeight: 900, lineHeight: 1.12, color: '#fff' }}>
        Convierte {isTwo ? 'su canción' : 'su canción'} en una <span style={{ color: GOLD }}>película animada</span>
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
        Ya casi está. <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Suma la versión animada a tu pedido</strong> y
        convierte a {recipientName} en personaje animado — tú eliges el estilo — con bellas ilustraciones
        de su historia y movimiento en las escenas clave, al ritmo de su canción.
      </p>

      {/* Real animated-video preview */}
      <VideoHero />

      {/* Differentiator vs the $9.99 slideshow */}
      <div style={{
        marginTop: 14, fontSize: 12, color: '#fde68a', background: 'rgba(245,185,66,0.08)',
        border: '1px solid rgba(245,185,66,0.25)', borderRadius: 10, padding: '9px 12px', lineHeight: 1.45,
      }}>
        💡 <strong>No es un video de fotos.</strong> Son ilustraciones animadas hechas a mano —
        que cobran vida con movimiento en los momentos más especiales.
      </div>

      {/* Style chooser — pick Pixar or faithful caricature (opt-in; off in the funnel) */}
      {enableStylePicker && <StylePicker value={selectedStyle} onChange={onStyleChange} />}

      {/* Features */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
        {features.map(({ icon, label, sub }, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '10px 12px',
            border: '1px solid rgba(255,255,255,0.07)',
          }}>
            <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{icon}</span>
            <div>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#fff', lineHeight: 1.25 }}>{label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }}>{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Price + selection block */}
      <div style={{
        background: added
          ? 'linear-gradient(90deg, rgba(34,197,94,0.18), rgba(34,197,94,0.08))'
          : 'linear-gradient(90deg, rgba(245,185,66,0.12), rgba(247,77,166,0.1))',
        border: `1px solid ${added ? 'rgba(34,197,94,0.4)' : 'rgba(245,185,66,0.3)'}`,
        borderRadius: 14, padding: 16,
      }}>
        {/* Price header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 }}>
          {count === 2 ? (
            <>
              <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through' }}>${(PRICE * 2).toFixed(0)}</span>
              <span style={{ fontSize: 42, fontWeight: 900, lineHeight: 1, color: GOLD, display: 'inline-block' }}>${PRICE_BOTH}</span>
              <span style={{
                fontSize: 12, fontWeight: 800, color: '#22c55e', background: 'rgba(34,197,94,0.15)',
                padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(34,197,94,0.25)', whiteSpace: 'nowrap',
              }}>Ahorra ${(PRICE * 2 - PRICE_BOTH).toFixed(0)}</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.35)', textDecoration: 'line-through' }}>${ANCHOR}</span>
              <span style={{ fontSize: 46, fontWeight: 900, lineHeight: 1, color: GOLD, animation: added ? 'none' : 'aniPulse 1.6s ease-in-out infinite', display: 'inline-block' }}>${PRICE}</span>
              <div style={{ textAlign: 'left' }}>
                <span style={{
                  display: 'block', fontSize: 12, fontWeight: 800, color: '#22c55e',
                  background: 'rgba(34,197,94,0.15)', padding: '3px 10px', borderRadius: 20,
                  border: '1px solid rgba(34,197,94,0.25)', marginBottom: 3, whiteSpace: 'nowrap',
                }}>{isTwo ? `c/u · 2 = $${PRICE_BOTH}` : `Ahorra ${Math.round((1 - PRICE / ANCHOR) * 100)}%`}</span>
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>precio de lanzamiento</span>
              </div>
            </>
          )}
        </div>

        {isTwo ? (
          /* ── 2-song order: none / one (pick which) / both ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { c: 1, title: '🎬 Película animada para 1 canción', sub: 'Tú eliges cuál', price: `$${PRICE}` },
              { c: 2, title: '🎬🎬 Las 2 canciones animadas', sub: `Una película por cada canción · ahorra $${(PRICE * 2 - PRICE_BOTH).toFixed(0)}`, price: `$${PRICE_BOTH}` },
              { c: 0, title: '❌ Sin video animado', sub: 'Solo la(s) canción(es)', price: null },
            ].map(({ c, title, sub, price: p }) => {
              const sel = count === c;
              return (
                <div key={c}>
                  <button
                    onClick={() => onChange(c, c === 1 ? chosenSongId : null)}
                    style={{
                      width: '100%', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                      border: sel ? `2px solid ${c === 0 ? 'rgba(255,255,255,0.3)' : GOLD}` : '2px solid rgba(255,255,255,0.1)',
                      background: sel ? (c === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(245,185,66,0.14)') : 'rgba(255,255,255,0.04)',
                      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        border: sel ? `2px solid ${GOLD}` : '2px solid rgba(255,255,255,0.3)',
                        background: sel && c !== 0 ? GOLD : 'transparent', display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                      }}>{sel && c !== 0 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1a1020' }} />}</span>
                      <span>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800 }}>{title}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{sub}</span>
                      </span>
                    </span>
                    {p && <span style={{ fontSize: 15, fontWeight: 900, color: GOLD, flexShrink: 0 }}>{p}</span>}
                  </button>

                  {/* which-song picker, only under the selected "1 video" option */}
                  {c === 1 && sel && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingLeft: 4 }}>
                      {songs.map((s) => {
                        const on = chosenSongId === s.id;
                        return (
                          <button key={s.id} onClick={() => onChange(1, s.id)} style={{
                            flex: 1, padding: '9px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 800,
                            border: on ? `2px solid ${PINK}` : '2px solid rgba(255,255,255,0.12)',
                            background: on ? 'rgba(247,77,166,0.18)' : 'rgba(255,255,255,0.04)',
                            color: on ? '#fff' : 'rgba(255,255,255,0.6)', transition: 'all 0.2s',
                          }}>
                            {on ? '✓ ' : ''}{verLabel(s)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── single-song order: simple add / remove toggle ── */
          <button
            onClick={() => onChange(added ? 0 : 1, songs[0]?.id)}
            style={{
              width: '100%', padding: '15px', borderRadius: 14, border: 'none', cursor: 'pointer',
              fontSize: 16, fontWeight: 900, color: added ? '#fff' : '#1a1020',
              background: added ? 'linear-gradient(135deg,#16a34a,#22c55e)' : `linear-gradient(135deg, ${GOLD}, ${PINK})`,
              boxShadow: added ? '0 0 18px rgba(34,197,94,0.4)' : '0 6px 20px rgba(247,77,166,0.4)',
              transition: 'all 0.25s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {added ? '✓ Agregado a tu pedido' : `🎬 Agregar a mi pedido — $${PRICE}`}
          </button>
        )}

        {/* selected confirmation for 2-song mode */}
        {isTwo && added && (
          <p style={{ margin: '12px 0 0', fontSize: 12, fontWeight: 700, color: '#4ade80', textAlign: 'center' }}>
            ✓ Agregado a tu pedido — {count === 2 ? 'las 2 canciones' : verLabel(songs.find((s) => s.id === chosenSongId) || songs[0])} · ${price}
          </p>
        )}
      </div>

      {/* Trust line */}
      <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 1.5 }}>
        🤚 Hecho a mano y revisado por nuestro equipo antes de enviártelo · ⏱️ Listo en 1–2 días · ✅ Aprobación de calidad garantizada
      </p>

      {/* Likeness expectation */}
      <p style={{ margin: '8px 0 0', fontSize: 10.5, color: 'rgba(255,255,255,0.32)', textAlign: 'center', lineHeight: 1.5 }}>
        Hacemos nuestro mejor esfuerzo para lograr el parecido. Al ser estilo animado,
        es una versión artística inspirada en su foto y puede no ser 100% exacta.
      </p>
    </div>
  );
}

// ── Reusable labeled dropzone (onPick receives the File) ──
function PhotoDrop({ icon = '📸', title, hint, value, onPick, required = false }) {
  const name = value?.name || null;
  // show an actual thumbnail of the chosen file so the customer can confirm they
  // picked the right photo (before it was just an emoji + filename).
  const [thumb, setThumb] = useState(null);
  useEffect(() => {
    if (!value) { setThumb(null); return; }
    let url = null;
    try { url = URL.createObjectURL(value); setThumb(url); } catch { setThumb(null); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [value]);
  return (
    <label style={{
      display: 'block', cursor: 'pointer', border: `2px dashed ${name ? '#22c55e' : 'rgba(245,185,66,0.6)'}`,
      borderRadius: 16, padding: name ? '12px' : '22px 16px', textAlign: 'center',
      background: name ? 'rgba(34,197,94,0.08)' : 'rgba(245,185,66,0.05)', transition: 'all 0.2s',
    }}>
      <input type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => onPick(e.target.files?.[0] || null)} />
      {thumb ? (
        <img src={thumb} alt={name || 'foto'} style={{
          display: 'block', width: '100%', maxHeight: 220, objectFit: 'contain',
          borderRadius: 10, marginBottom: 8, background: 'rgba(0,0,0,0.3)',
        }} />
      ) : (
        <div style={{ fontSize: 34, marginBottom: 6, animation: 'aniFloat 3s ease-in-out infinite' }}>{icon}</div>
      )}
      <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: name ? '#22c55e' : '#fff' }}>
        {name ? '✓ Foto seleccionada' : title}{required && !name && <span style={{ color: PINK }}> *</span>}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.4, wordBreak: 'break-word' }}>
        {name ? `${name} · toca para cambiarla` : hint}
      </p>
    </label>
  );
}

// Join names naturally: ["A","B","C"] -> "A, B y C"
function formatNames(names = []) {
  if (!names.length) return 'tu familia';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCREEN 2 — POST-PURCHASE PHOTO UPLOAD
//  Main person photo is required; a family photo slot appears ONLY when the
//  story includes other people. Who's-who is resolved at the admin review gate.
// ═══════════════════════════════════════════════════════════════════════════
// Customer-facing labels for the cast roles (keys match animado-photo's ROLES enum).
const ROLE_LABELS = {
  recipient: 'El festejado/a (para quién es)',
  sender: 'Yo (quien regala)',
  spouse: 'Mi pareja / esposo(a)',
  daughter: 'Hija',
  son: 'Hijo',
  mother: 'Mamá',
  father: 'Papá',
  grandmother: 'Abuela',
  grandfather: 'Abuelo',
  sibling: 'Hermano(a)',
  friend: 'Amigo(a)',
  other: 'Otro',
};

export function AnimadoPhotoUpload({ recipientName = 'Papá', isFamily = false, otherPeople = [], askPhone = false, onSubmit = null, onAnalyze = null, onConfirm = null }) {
  const [mainPhoto, setMainPhoto] = useState(null);   // File
  const [familyPhoto, setFamilyPhoto] = useState(null); // File
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('pick');   // 'pick' | 'quality' | 'tagging'
  const [cast, setCast] = useState([]);          // [{ key, description, role, name, in_photo }]
  const [previewUrl, setPreviewUrl] = useState(null); // object URL of the photo, for the tagging step
  const [qualityIssues, setQualityIssues] = useState([]); // reasons the photo may be too poor to use
  const [formatWarning, setFormatWarning] = useState(''); // 'heic' when an iPhone HEIC file is picked

  // iPhone's default HEIC/HEIF format isn't readable by the image models and would
  // fail the build — detect it on pick and ask for a JPG/PNG.
  const isHeic = (f) => !!f && (/\.hei[cf]$/i.test(f.name || '') || /image\/hei[cf]/i.test(f.type || ''));
  const pickMain = (f) => { setMainPhoto(f); setFormatWarning(isHeic(f) || isHeic(familyPhoto) ? 'heic' : ''); };
  const pickFamily = (f) => { setFamilyPhoto(f); setFormatWarning(isHeic(f) || isHeic(mainPhoto) ? 'heic' : ''); };

  // Never let the customer hang on "Guardando…": if the confirm call stalls past
  // the timeout, show the success screen anyway — the server has almost certainly
  // saved (the heavy likeness/storyboard work runs in the background). A fast,
  // genuine error still surfaces normally.
  const confirmSafely = (payload) => new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; resolve('timeout'); } }, 12000);
    onConfirm(payload).then(
      () => { if (!settled) { settled = true; clearTimeout(t); resolve('ok'); } },
      (e) => { if (!settled) { settled = true; clearTimeout(t); reject(e); } },
    );
  });

  // Once the photo passes the quality gate (or the customer chooses to use it
  // anyway): confirm who-is-who if 2+ people, else finalize the upload directly.
  const proceedAfterQuality = async (list) => {
    if ((list || []).length >= 2) {
      setPhase('tagging');
      setSubmitting(false);
    } else {
      setSubmitting(true);
      try {
        await confirmSafely({ cast: list || [], phone: phone.trim() || null, hasFamily: !!familyPhoto });
        setDone(true);
      } catch (e) {
        setError(e?.message || 'No se pudo guardar. Intenta de nuevo.');
        setSubmitting(false);
      }
    }
  };

  // Stage 3 + quality gate: upload -> analyze (grade photo + detect people). A poor
  // photo routes to the 'quality' warning first; then 2+ people -> tagging, else
  // confirm. Falls back to the legacy one-shot onSubmit when props aren't wired.
  const handleContinue = async () => {
    if (!mainPhoto || submitting) return;
    setError(null);
    if (!onAnalyze) {
      if (!onSubmit) { setDone(true); return; } // demo mode — no real upload
      setSubmitting(true);
      try { await onSubmit({ mainFile: mainPhoto, familyFile: familyPhoto, phone: phone.trim() || null }); setDone(true); }
      catch (e) { setError(e?.message || 'No se pudo subir la foto. Intenta de nuevo.'); }
      finally { setSubmitting(false); }
      return;
    }
    setSubmitting(true);
    try {
      const res = await onAnalyze({ mainFile: mainPhoto, familyFile: familyPhoto, phone: phone.trim() || null });
      // supports the {cast,quality} shape or a bare array (older callers)
      const list = (Array.isArray(res) ? res : (Array.isArray(res?.cast) ? res.cast : []))
        .map((c) => ({ ...c, role: c.role || 'other', name: c.name || '' }));
      const quality = (res && res.quality) ? res.quality : { usable: true, issues: [] };
      setCast(list);
      try { setPreviewUrl(URL.createObjectURL(familyPhoto || mainPhoto)); } catch { /* preview optional */ }
      if (quality.usable === false) {
        setQualityIssues(Array.isArray(quality.issues) ? quality.issues : []);
        setPhase('quality');
        setSubmitting(false);
        return;
      }
      await proceedAfterQuality(list);
    } catch (e) {
      setError(e?.message || 'No se pudo procesar la foto. Intenta de nuevo.');
      setSubmitting(false);
    }
  };

  const handleConfirmCast = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await confirmSafely({ cast, phone: phone.trim() || null, hasFamily: !!familyPhoto });
      setDone(true);
    } catch (e) {
      setError(e?.message || 'No se pudo guardar. Intenta de nuevo.');
      setSubmitting(false);
    }
  };

  const setCastField = (i, field, val) =>
    setCast((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));

  const steps = [
    { n: 1, t: 'Creamos 2 bocetos de su personaje', s: 'Tú no haces nada — nuestro equipo elige el mejor' },
    { n: 2, t: 'Animamos su historia, escena por escena', s: 'Al ritmo de su canción' },
    { n: 3, t: 'Revisamos la calidad a mano', s: 'Nada se envía sin nuestra aprobación' },
    { n: 4, t: 'Te lo enviamos por email', s: 'En 1–2 días, en HD y listo para compartir' },
  ];

  // Quality gate — the photo looks too poor to build a faithful likeness from.
  // Strongly nudge a better photo, but let them proceed if they insist.
  if (phase === 'quality') {
    return (
      <div style={{
        background: 'linear-gradient(160deg, #1a1020 0%, #140d18 100%)',
        border: '2px solid rgba(245,185,66,0.5)', borderRadius: 20, padding: 22,
        animation: 'aniFade 0.5s ease-out both',
      }}>
        <style>{ANIM_CSS}</style>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{
            width: 54, height: 54, borderRadius: '50%', margin: '0 auto 12px',
            background: 'rgba(245,185,66,0.15)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 28,
          }}>⚠️</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 900, color: '#fff' }}>Esta foto podría no salir bien</h2>
          <p style={{ margin: 0, fontSize: 13.5, color: 'rgba(255,255,255,0.62)', lineHeight: 1.5 }}>
            Para lograr el mejor parecido, te recomendamos subir una foto más clara.
          </p>
        </div>
        {previewUrl && (
          <img src={previewUrl} alt="tu foto" style={{
            display: 'block', width: '100%', maxHeight: 200, objectFit: 'contain',
            borderRadius: 12, marginBottom: 14, background: 'rgba(0,0,0,0.25)',
          }} />
        )}
        {qualityIssues.length > 0 && (
          <div style={{ background: 'rgba(245,185,66,0.08)', border: '1px solid rgba(245,185,66,0.3)', borderRadius: 12, padding: '11px 13px', marginBottom: 14 }}>
            {qualityIssues.map((iss, i) => (
              <p key={i} style={{ margin: i ? '5px 0 0' : 0, fontSize: 12.5, color: '#fde68a', lineHeight: 1.4 }}>• {iss}</p>
            ))}
          </div>
        )}
        <button onClick={() => { setPhase('pick'); setSubmitting(false); }} style={{
          width: '100%', padding: 14, borderRadius: 14, border: 'none', cursor: 'pointer',
          fontSize: 15.5, fontWeight: 900, color: '#1a1020', background: `linear-gradient(135deg, ${GOLD}, ${PINK})`,
          boxShadow: '0 6px 20px rgba(247,77,166,0.4)', transition: 'all 0.25s',
        }}>📷 Subir otra foto</button>
        <button onClick={() => proceedAfterQuality(cast)} disabled={submitting} style={{
          width: '100%', marginTop: 10, padding: 12, borderRadius: 12, border: '1.5px solid rgba(255,255,255,0.18)',
          cursor: submitting ? 'wait' : 'pointer', fontSize: 13.5, fontWeight: 700,
          color: 'rgba(255,255,255,0.7)', background: 'transparent', transition: 'all 0.25s',
        }}>{submitting ? 'Procesando…' : 'Usar esta de todos modos'}</button>
      </div>
    );
  }

  // Stage 3 — "who is who": the customer confirms each detected person so the
  // video animates the right people (and knows who is grandma vs. daughter).
  if (phase === 'tagging') {
    const allTagged = cast.length > 0 && cast.every((c) => c.role);
    return (
      <div style={{
        background: 'linear-gradient(160deg, #1a1020 0%, #140d18 100%)',
        border: '2px solid rgba(245,185,66,0.45)', borderRadius: 20, padding: 22,
        animation: 'aniFade 0.5s ease-out both',
      }}>
        <style>{ANIM_CSS}</style>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 21, fontWeight: 900, color: '#fff' }}>¿Quién es quién? 👀</h2>
          <p style={{ margin: 0, fontSize: 13.5, color: 'rgba(255,255,255,0.62)', lineHeight: 1.5 }}>
            Encontramos <strong style={{ color: GOLD }}>{cast.length} personas</strong> en tu foto.
            Dinos quién es cada una para que salgan perfectas en el video.
          </p>
        </div>

        {previewUrl && (
          <img src={previewUrl} alt="tu foto" style={{
            display: 'block', width: '100%', maxHeight: 220, objectFit: 'contain',
            borderRadius: 12, marginBottom: 16, background: 'rgba(0,0,0,0.25)',
          }} />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cast.map((c, i) => (
            <div key={c.key || i} style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, padding: '12px 13px',
            }}>
              <p style={{ margin: '0 0 9px', fontSize: 12.5, color: '#fde68a', lineHeight: 1.4, fontWeight: 600 }}>
                👤 {c.description || `Persona ${i + 1}`}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select
                  value={c.role || 'other'}
                  onChange={(e) => setCastField(i, 'role', e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 10px', fontSize: 13.5,
                    background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 9,
                    border: '1.5px solid rgba(255,255,255,0.14)', outline: 'none',
                  }}
                >
                  {Object.keys(ROLE_LABELS).map((r) => (
                    <option key={r} value={r} style={{ background: '#1a1020' }}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={c.name || ''}
                  onChange={(e) => setCastField(i, 'name', e.target.value.slice(0, 40))}
                  placeholder="Nombre (opcional)"
                  maxLength={40}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 14,
                    background: 'rgba(255,255,255,0.06)', color: '#fff', borderRadius: 9,
                    border: '1.5px solid rgba(255,255,255,0.12)', outline: 'none',
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {error && (
          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: '#f87171', textAlign: 'center', fontWeight: 700 }}>{error}</p>
        )}
        <button onClick={handleConfirmCast} disabled={!allTagged || submitting} style={{
          width: '100%', marginTop: 16, padding: 15, borderRadius: 14, border: 'none',
          cursor: allTagged && !submitting ? 'pointer' : 'not-allowed', fontSize: 16, fontWeight: 900,
          color: allTagged ? '#1a1020' : 'rgba(255,255,255,0.35)',
          background: allTagged ? `linear-gradient(135deg, ${GOLD}, ${PINK})` : 'rgba(255,255,255,0.06)',
          boxShadow: allTagged && !submitting ? '0 6px 20px rgba(247,77,166,0.4)' : 'none', transition: 'all 0.25s',
        }}>
          {submitting ? 'Guardando…' : 'Confirmar y crear 🎬'}
        </button>
        <p style={{ margin: '10px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 1.45 }}>
          Esto nos ayuda a animar a cada persona correctamente en tu video.
        </p>
      </div>
    );
  }

  // Confirmation view after the photo is submitted
  if (done) {
    return (
      <div style={{
        background: 'linear-gradient(160deg, #1a1020 0%, #140d18 100%)',
        border: '2px solid rgba(34,197,94,0.5)', borderRadius: 20, padding: 26, textAlign: 'center',
        animation: 'aniFade 0.6s ease-out both',
      }}>
        <style>{ANIM_CSS}</style>
        <div style={{
          width: 62, height: 62, borderRadius: '50%', margin: '0 auto 14px',
          background: 'linear-gradient(135deg,#16a34a,#22c55e)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 32, boxShadow: '0 0 24px rgba(34,197,94,0.5)',
        }}>✓</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 900, color: '#fff' }}>¡Foto recibida! 🎬</h2>
        <p style={{ margin: '0 0 6px', fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>
          Ya empezamos a crear la película animada de <strong style={{ color: GOLD }}>{recipientName}</strong>.
          Te la enviaremos por email en <strong>1–2 días</strong>.
        </p>
        <p style={{ margin: '14px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
          Si necesitamos una mejor foto, te escribimos. Hacemos nuestro mejor esfuerzo para
          lograr el parecido — al ser estilo animado (Pixar) puede no ser 100% exacta.
        </p>
      </div>
    );
  }

  return (
    <div style={{
      background: 'linear-gradient(160deg, #1a1020 0%, #140d18 100%)',
      border: '2px solid rgba(245,185,66,0.45)', borderRadius: 20, padding: 22,
      animation: 'aniFade 0.6s ease-out both',
    }}>
      <style>{ANIM_CSS}</style>

      {/* Success header */}
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{
          width: 58, height: 58, borderRadius: '50%', margin: '0 auto 12px',
          background: 'linear-gradient(135deg,#16a34a,#22c55e)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 30,
          boxShadow: '0 0 24px rgba(34,197,94,0.45)',
        }}>✓</div>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 900, color: '#fff' }}>
          ¡Tu película animada está en camino! 🎬
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
          Sube una foto y crearemos su personaje. Entre más clara la cara, mejor el parecido.
        </p>
      </div>

      {/* Required: main person */}
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 800, color: '#fff' }}>
        📷 Foto de {recipientName} <span style={{ color: PINK }}>· requerida</span>
      </p>
      <PhotoDrop
        title={`Sube una foto clara de ${recipientName}`}
        hint="JPG o PNG · de frente, buena luz, rostro cercano"
        value={mainPhoto}
        onPick={pickMain}
        required
      />

      {formatWarning === 'heic' && (
        <div style={{ marginTop: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 12, padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: 12.5, color: '#fca5a5', lineHeight: 1.45, fontWeight: 700 }}>
            ⚠️ Esa foto es formato HEIC (iPhone) y no la podemos procesar.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
            Ábrela y toma una captura de pantalla, o cámbiala a JPG, y súbela de nuevo.
          </p>
        </div>
      )}

      {/* Optional: family photo — only when the story has other people */}
      {isFamily && (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 800, color: '#fff' }}>
            👨‍👩‍👧‍👦 Foto familiar <span style={{ color: 'rgba(255,255,255,0.45)' }}>· recomendada</span>
          </p>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: '#fde68a', lineHeight: 1.45 }}>
            {otherPeople.length
              ? <>Tu canción también incluye a <strong>{formatNames(otherPeople)}</strong>. </>
              : <>¿Tu canción también incluye a tu <strong>familia, pareja o hijos</strong>? </>}
            Sube <strong>una foto donde salgan todos juntos</strong> para que se parezcan.
            (Si no, los animamos de forma general.)
          </p>
          <PhotoDrop
            icon="👨‍👩‍👧‍👦"
            title="Sube una foto familiar (todos juntos)"
            hint="JPG o PNG · que se vean bien todas las caras"
            value={familyPhoto}
            onPick={pickFamily}
          />
        </div>
      )}

      {/* Good vs bad photo guidance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '16px 0' }}>
        <div style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 12, padding: '11px 12px' }}>
          <p style={{ margin: '0 0 7px', fontSize: 12.5, fontWeight: 800, color: '#4ade80' }}>✅ Sí funciona</p>
          {['De frente y bien iluminada', 'Rostro claro y cercano', isFamily ? 'Todos completos, sin cortar a nadie' : 'Una sola persona', 'Una foto reciente y nítida'].map((t, i) => (
            <p key={i} style={{ margin: '0 0 4px', fontSize: 11.5, color: 'rgba(255,255,255,0.6)', lineHeight: 1.35 }}>• {t}</p>
          ))}
        </div>
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)', borderRadius: 12, padding: '11px 12px' }}>
          <p style={{ margin: '0 0 7px', fontSize: 12.5, fontWeight: 800, color: '#f87171' }}>❌ Evita</p>
          {['Borrosa o muy oscura', 'Lentes de sol o gorra tapando', 'Filtros o efectos (deforman el rostro)', 'De muy lejos o de lado'].map((t, i) => (
            <p key={i} style={{ margin: '0 0 4px', fontSize: 11.5, color: 'rgba(255,255,255,0.6)', lineHeight: 1.35 }}>• {t}</p>
          ))}
        </div>
      </div>

      {/* Phone (only when we don't already have one) — so we can reach them about
          the photo and tell them the moment the video is ready */}
      {askPhone && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 800, color: '#fff' }}>
            📱 Tu teléfono <span style={{ color: GOLD }}>· recomendado</span> <span style={{ color: 'rgba(255,255,255,0.45)' }}>· para avisarte cuando esté listo</span>
          </p>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d\s\-\+\(\)]/g, ''))}
            placeholder="Tu número de teléfono"
            maxLength={20}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px 14px',
              background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 15, outline: 'none',
              border: phone.replace(/\D/g, '').length >= 10 ? `1.5px solid #22c55e` : '1.5px solid rgba(255,255,255,0.12)',
              borderRadius: 10, transition: 'border-color 0.25s',
            }}
          />
        </div>
      )}

      {/* Submit */}
      {error && (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#f87171', textAlign: 'center', fontWeight: 700 }}>{error}</p>
      )}
      {(() => { const ready = mainPhoto && formatWarning !== 'heic'; return (
      <button onClick={handleContinue} disabled={!ready || submitting} style={{
        width: '100%', padding: 15, borderRadius: 14, border: 'none',
        cursor: ready && !submitting ? 'pointer' : 'not-allowed', fontSize: 16, fontWeight: 900,
        color: ready ? '#1a1020' : 'rgba(255,255,255,0.35)',
        background: ready ? `linear-gradient(135deg, ${GOLD}, ${PINK})` : 'rgba(255,255,255,0.06)',
        boxShadow: ready && !submitting ? '0 6px 20px rgba(247,77,166,0.4)' : 'none', transition: 'all 0.25s', marginBottom: 20,
      }}>
        {submitting ? 'Subiendo…' : formatWarning === 'heic' ? 'Sube una foto JPG o PNG' : mainPhoto ? 'Enviar y empezar 🚀' : `Sube la foto de ${recipientName} para continuar`}
      </button>
      ); })()}

      {/* What happens next */}
      <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 800, color: '#fff', textAlign: 'center' }}>Qué sigue</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map(({ n, t, s }) => (
          <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg, ${GOLD}, ${PINK})`, color: '#1a1020',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900,
            }}>{n}</div>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{t}</p>
              <p style={{ margin: '1px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }}>{s}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Likeness expectation */}
      <p style={{ margin: '16px 0 0', fontSize: 10.5, color: 'rgba(255,255,255,0.32)', textAlign: 'center', lineHeight: 1.5 }}>
        Hacemos nuestro mejor esfuerzo para lograr el parecido. Al ser estilo animado (Pixar),
        es una versión artística inspirada en su foto y puede no ser 100% exacta.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  LOCAL DEMO PAGE — toggle between the two screens
// ═══════════════════════════════════════════════════════════════════════════
export default function AnimadoUpsell() {
  const [view, setView] = useState('offer');   // 'offer' | 'upload'
  const [orderSongs, setOrderSongs] = useState(1); // 1 or 2 songs in the order (demo)
  const [count, setCount] = useState(0);        // animated videos selected
  const [videoSongId, setVideoSongId] = useState(null);
  const [style, setStyle] = useState('pixar');  // 'pixar' | 'likeness'
  const [uploadFamily, setUploadFamily] = useState(false); // demo: story has other people?

  const songs = orderSongs === 2
    ? [{ id: 's1', version: 1 }, { id: 's2', version: 2 }]
    : [{ id: 's1', version: 1 }];

  const setScenario = (n) => { setOrderSongs(n); setCount(0); setVideoSongId(null); };

  const pill = (active) => ({
    padding: '8px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
    border: active ? `1px solid ${GOLD}` : '1px solid rgba(255,255,255,0.15)',
    background: active ? 'rgba(245,185,66,0.15)' : 'transparent',
    color: active ? GOLD : 'rgba(255,255,255,0.6)', transition: 'all 0.2s',
  });

  return (
    <div style={{ background: '#0c0810', minHeight: '100vh', padding: '20px 0 80px' }}>
      {/* Demo-only controls (not shown to real customers) */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
        padding: '12px', background: 'rgba(12,8,16,0.92)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 20,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['offer', '1 · La oferta'], ['upload', '2 · Subir foto']].map(([k, lbl]) => (
            <button key={k} onClick={() => setView(k)} style={pill(view === k)}>{lbl}</button>
          ))}
        </div>
        {view === 'offer' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Pedido:</span>
            <button onClick={() => setScenario(1)} style={pill(orderSongs === 1)}>1 canción</button>
            <button onClick={() => setScenario(2)} style={pill(orderSongs === 2)}>2 canciones</button>
          </div>
        )}
        {view === 'upload' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Historia:</span>
            <button onClick={() => setUploadFamily(false)} style={pill(!uploadFamily)}>Para 1 persona</button>
            <button onClick={() => setUploadFamily(true)} style={pill(uploadFamily)}>Para la familia</button>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 460, margin: '0 auto', padding: '0 14px' }}>
        {view === 'offer'
          ? <AnimadoOffer
              recipientName="Papá"
              songs={songs}
              count={count}
              selectedVideoSongId={videoSongId}
              selectedStyle={style}
              onStyleChange={setStyle}
              enableStylePicker
              onChange={(c, id) => { setCount(c); setVideoSongId(id); }}
            />
          : <AnimadoPhotoUpload
              recipientName={uploadFamily ? 'Erica' : 'Papá'}
              isFamily={uploadFamily}
              otherPeople={uploadFamily ? ['Julián', 'Jahziel', 'Jaxon'] : []}
            />}
      </div>
    </div>
  );
}
