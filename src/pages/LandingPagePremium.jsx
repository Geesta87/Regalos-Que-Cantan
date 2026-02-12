import React, { useContext, useEffect } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';

const HEART_SVG = "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z";

const FLOATING_HEARTS = [
  { left: '5%', dur: '14s', delay: '0s', size: 18 },
  { left: '15%', dur: '18s', delay: '3s', size: 12 },
  { left: '35%', dur: '20s', delay: '7s', size: 14 },
  { left: '55%', dur: '16s', delay: '2s', size: 10 },
  { left: '75%', dur: '22s', delay: '5s', size: 16 },
  { left: '90%', dur: '17s', delay: '9s', size: 11 },
];

const VIDEOS = [
  { src: '/videos/testimonial1.mp4', id: 'v1' },
  { src: '/videos/testimonial2.mp4', id: 'v2' },
  { src: '/videos/testimonial3.mp4', id: 'v3' },
];

const FEATURES = [
  'Canción completa de ~2 minutos',
  '2 versiones únicas para elegir',
  'Letra 100% personalizada con nombres reales',
  'Descarga MP3 de alta calidad',
  'Página de regalo especial para compartir',
  'Entrega instantánea — lista en minutos',
];

const STEPS = [
  { emoji: '🎵', num: '01', title: 'Elige el Género', desc: 'Corrido, Banda, Bachata, Balada, Reggaetón y más. El sonido perfecto para tu historia de amor.' },
  { emoji: '💌', num: '02', title: 'Cuéntanos su Historia', desc: 'Los nombres, la ocasión, y esos detalles que solo tú conoces. Lo que hace único a su amor.' },
  { emoji: '🎁', num: '03', title: 'Regala la Canción', desc: 'En ~3 minutos recibes 2 versiones únicas. Compártela por WhatsApp con una página de regalo especial.' },
];

export default function LandingPagePremium() {
  const { navigateTo, updateFormData, setFormData, formData } = useContext(AppContext);

  // ✅ Set premium tier on mount
  useEffect(() => {
    updateFormData('pricingTier', 'premium');
    trackStep('landing_premium');
  }, []);

  const handleCTA = () => {
    // Ensure tier persists even if formData was loaded from localStorage without it
    if (formData?.pricingTier !== 'premium') {
      updateFormData('pricingTier', 'premium');
    }
    navigateTo('genre');
  };

  const handleLogoClick = () => {
    navigateTo('landing_premium');
  };

  const handleVideoToggle = (e) => {
    const wrapper = e.currentTarget;
    const video = wrapper.querySelector('video');
    const overlay = wrapper.querySelector('[data-overlay]');
    if (!video) return;
    if (video.paused) {
      video.play();
      if (overlay) overlay.style.display = 'none';
    } else {
      video.pause();
      if (overlay) overlay.style.display = 'flex';
    }
  };

  return (
    <div style={{ background: '#0a0507', color: 'white', fontFamily: "'Plus Jakarta Sans', sans-serif", overflowX: 'hidden', minHeight: '100vh' }}>
      {/* Google Fonts */}
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* CSS Animations */}
      <style>{`
        @keyframes lpp-heartbeat { 0%,100% { transform: scale(1); } 14% { transform: scale(1.15); } 28% { transform: scale(1); } }
        @keyframes lpp-floatUp {
          0% { opacity: 0; transform: translateY(100vh) rotate(0deg) scale(0.5); }
          10% { opacity: 1; } 90% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-10vh) rotate(25deg) scale(1); }
        }
        @keyframes lpp-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes lpp-shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        .lpp-shimmer {
          background: linear-gradient(90deg, #c9184a, #ff6b8a, #c9184a, #ff6b8a, #c9184a);
          background-size: 200% auto;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: lpp-shimmer 4s linear infinite;
        }
        .lpp-hero-cta:hover { transform: scale(1.05) !important; box-shadow: 0 12px 40px rgba(201,24,74,0.4) !important; }
        .lpp-cta-btn:hover { transform: scale(1.03) !important; box-shadow: 0 8px 30px rgba(201,24,74,0.35) !important; }
        .lpp-header-cta:hover { background: rgba(201,24,74,0.1) !important; border-color: #c9184a !important; }
        .lpp-step:hover { border-color: rgba(201,24,74,0.2) !important; background: rgba(201,24,74,0.03) !important; }
        .lpp-video-card:hover { border-color: rgba(201,24,74,0.3) !important; transform: translateY(-4px) !important; }
        .lpp-video-card:hover .lpp-play-btn { transform: scale(1.1) !important; background: rgba(201,24,74,0.95) !important; }
        .lpp-video-card:hover .lpp-play-overlay { background: rgba(0,0,0,0.15) !important; }
        @media (max-width: 768px) {
          .lpp-steps-grid { flex-direction: column !important; align-items: center !important; }
          .lpp-header { padding: 16px 20px !important; }
          .lpp-pricing-card { padding: 36px 24px !important; }
          .lpp-video-card { max-height: 420px !important; }
          .lpp-play-btn { width: 52px !important; height: 52px !important; font-size: 18px !important; }
        }
        @media (max-width: 480px) {
          .lpp-video-card { max-height: 300px !important; }
          .lpp-play-btn { width: 40px !important; height: 40px !important; font-size: 14px !important; }
        }
      `}</style>

      {/* TOP BAR */}
      <div style={{
        background: 'linear-gradient(90deg, #1a080e, #2a1018, #1a080e)',
        borderBottom: '1px solid rgba(201,24,74,0.2)',
        textAlign: 'center', padding: '12px 20px',
        fontSize: '13px', letterSpacing: '0.1em', color: 'rgba(255,182,193,0.7)',
        position: 'sticky', top: 0, zIndex: 100
      }}>
        ♥ &nbsp; Edición Especial San Valentín &nbsp;·&nbsp; Tu canción lista en minutos &nbsp; ♥
      </div>

      {/* HEADER */}
      <div className="lpp-header" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '20px 40px', maxWidth: '1200px', margin: '0 auto'
      }}>
        <button onClick={handleLogoClick} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: "'Playfair Display', serif", fontSize: '22px', fontWeight: 700,
          color: 'white', letterSpacing: '-0.02em'
        }}>
          Regalos<span style={{ color: '#d4af37' }}>Que</span>Cantan
        </button>
        <button className="lpp-header-cta" onClick={handleCTA} style={{
          background: 'transparent', border: '1px solid rgba(201,24,74,0.4)', color: '#ff8fa3',
          padding: '10px 28px', borderRadius: '999px', fontSize: '13px', fontWeight: 600,
          letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.3s'
        }}>
          Crear Canción
        </button>
      </div>

      {/* HERO */}
      <section style={{
        position: 'relative', minHeight: '90vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center', padding: '80px 24px', overflow: 'hidden'
      }}>
        {/* Radial glow */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 20%, rgba(201,24,74,0.15) 0%, transparent 50%), radial-gradient(ellipse at 30% 70%, rgba(212,175,55,0.1) 0%, transparent 40%)'
        }} />

        {/* Floating hearts */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 1 }}>
          {FLOATING_HEARTS.map((h, i) => (
            <div key={i} style={{
              position: 'absolute', left: h.left, opacity: 0,
              animation: `lpp-floatUp ${h.dur} linear ${h.delay} infinite`
            }}>
              <svg width={h.size} height={h.size} viewBox="0 0 24 24" style={{ fill: '#c9184a', opacity: 0.07 }}>
                <path d={HEART_SVG} />
              </svg>
            </div>
          ))}
        </div>

        {/* Ambient particles */}
        {['♪','✦','♫','✧'].map((p, i) => (
          <div key={i} style={{
            position: 'absolute', color: 'rgba(201,24,74,0.06)',
            animation: `lpp-float 6s ease-in-out ${i * 0.5}s infinite`,
            pointerEvents: 'none', fontSize: '24px',
            ...[{ top: '15%', left: '8%' }, { top: '25%', right: '12%' }, { bottom: '30%', left: '15%' }, { bottom: '20%', right: '8%' }][i]
          }}>{p}</div>
        ))}

        {/* Hero content */}
        <div style={{ position: 'relative', zIndex: 10, maxWidth: '700px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            background: 'rgba(201,24,74,0.08)', border: '1px solid rgba(201,24,74,0.25)',
            borderRadius: '999px', padding: '8px 22px', marginBottom: '32px',
            fontSize: '11px', letterSpacing: '0.25em', textTransform: 'uppercase',
            color: '#ff8fa3', fontWeight: 600
          }}>
            <span style={{ display: 'inline-block', color: '#c9184a', fontSize: '10px', animation: 'lpp-heartbeat 1.4s ease-in-out infinite' }}>♥</span>
            San Valentín · Edición Especial
            <span style={{ display: 'inline-block', color: '#c9184a', fontSize: '10px', animation: 'lpp-heartbeat 1.4s ease-in-out infinite' }}>♥</span>
          </div>

          <h1 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 'clamp(40px, 7vw, 72px)', fontWeight: 400, lineHeight: 1.05,
            marginBottom: '24px', letterSpacing: '-0.02em'
          }}>
            Regala algo que<br />
            <strong style={{ fontWeight: 900 }}>nadie más</strong>{' '}
            <em className="lpp-shimmer" style={{ fontStyle: 'italic' }}>puede dar</em>
          </h1>

          <p style={{
            fontSize: '18px', color: 'rgba(255,255,255,0.5)', fontWeight: 300,
            lineHeight: 1.7, maxWidth: '520px', margin: '0 auto 40px'
          }}>
            Una canción compuesta exclusivamente para esa persona especial.
            Su nombre, su historia, su género favorito. Un regalo{' '}
            <em style={{ color: 'rgba(255,182,193,0.7)', fontStyle: 'italic' }}>irrepetible</em> este San Valentín.
          </p>

          <button className="lpp-hero-cta" onClick={handleCTA} style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            background: 'linear-gradient(135deg, #c9184a, #a01540)',
            color: 'white', padding: '18px 48px', borderRadius: '999px', border: 'none',
            fontSize: '16px', fontWeight: 800, cursor: 'pointer',
            boxShadow: '0 8px 32px rgba(201,24,74,0.3)',
            transition: 'all 0.3s', letterSpacing: '0.02em'
          }}>
            ♥ &nbsp; Crear Su Canción
          </button>

          <p style={{ marginTop: '20px', fontSize: '13px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.05em' }}>
            Preview gratis · Listo en ~3 minutos · A tiempo para el sábado
          </p>
        </div>
      </section>

      {/* DIVIDER */}
      <div style={{ width: '60px', height: '1px', margin: '0 auto', background: 'linear-gradient(90deg, transparent, #c9184a, transparent)' }} />
      <div style={{ textAlign: 'center', padding: '8px 0', color: '#c9184a', fontSize: '10px', opacity: 0.3, letterSpacing: '12px' }}>♥ ♥ ♥</div>

      {/* VIDEO TESTIMONIALS */}
      <div style={{ padding: '80px 24px', maxWidth: '1100px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#ff8fa3', fontWeight: 600, marginBottom: '12px' }}>
          ♥ &nbsp; Reacciones Reales
        </div>
        <h2 style={{
          textAlign: 'center', fontFamily: "'Playfair Display', serif",
          fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 400, marginBottom: '48px', lineHeight: 1.2
        }}>
          Mira lo que pasa cuando <em style={{ fontStyle: 'italic', color: '#c9184a' }}>escuchan su canción</em>
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', alignItems: 'start' }}>
          {VIDEOS.map((v) => (
            <div key={v.id} className="lpp-video-card" style={{
              position: 'relative', borderRadius: '18px', overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.06)',
              transition: 'all 0.4s cubic-bezier(0.2, 0.8, 0.3, 1)',
              background: 'rgba(255,255,255,0.02)',
              aspectRatio: '9/16', maxHeight: '520px'
            }}>
              <div onClick={handleVideoToggle} style={{
                position: 'relative', width: '100%', height: '100%', cursor: 'pointer',
                borderRadius: '16px', overflow: 'hidden'
              }}>
                <video playsInline webkit-playsinline="" preload="metadata" style={{
                  width: '100%', height: '100%', objectFit: 'cover', borderRadius: '16px', display: 'block'
                }}>
                  <source src={v.src} type="video/mp4" />
                </video>
                <div data-overlay="" className="lpp-play-overlay" style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.25)', transition: 'all 0.3s', zIndex: 5
                }}>
                  <div className="lpp-play-btn" style={{
                    width: '64px', height: '64px', borderRadius: '50%',
                    background: 'rgba(201,24,74,0.85)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '22px', color: 'white', paddingLeft: '4px',
                    boxShadow: '0 8px 32px rgba(201,24,74,0.3)',
                    transition: 'all 0.3s', border: '2px solid rgba(255,255,255,0.15)'
                  }}>▶</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '13px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em' }}>
          ♥ &nbsp; Videos reales de clientes &nbsp; ♥
        </p>
      </div>

      {/* DIVIDER */}
      <div style={{ width: '60px', height: '1px', margin: '0 auto', background: 'linear-gradient(90deg, transparent, #c9184a, transparent)' }} />
      <div style={{ textAlign: 'center', padding: '8px 0', color: '#c9184a', fontSize: '10px', opacity: 0.3, letterSpacing: '12px' }}>♥ ♥ ♥</div>

      {/* HOW IT WORKS */}
      <div style={{ padding: '80px 24px', maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#ff8fa3', fontWeight: 600, marginBottom: '12px' }}>
          ♥ &nbsp; El Proceso
        </div>
        <h2 style={{
          textAlign: 'center', fontFamily: "'Playfair Display', serif",
          fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 400, marginBottom: '48px', lineHeight: 1.2
        }}>
          Tres pasos. <em style={{ fontStyle: 'italic', color: '#c9184a' }}>Una canción para siempre.</em>
        </h2>

        <div className="lpp-steps-grid" style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {STEPS.map((s, i) => (
            <div key={i} className="lpp-step" style={{
              flex: 1, minWidth: '240px', maxWidth: '300px', textAlign: 'center',
              padding: '40px 24px', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '20px', background: 'rgba(255,255,255,0.02)',
              transition: 'all 0.3s', position: 'relative', overflow: 'hidden'
            }}>
              <span style={{ fontSize: '28px', marginBottom: '12px', display: 'block' }}>{s.emoji}</span>
              <div style={{
                fontFamily: "'Playfair Display', serif", fontSize: '48px', fontWeight: 900,
                color: 'rgba(201,24,74,0.12)', marginBottom: '16px', lineHeight: 1
              }}>{s.num}</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>{s.title}</h3>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, fontWeight: 300 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* DIVIDER */}
      <div style={{ width: '60px', height: '1px', margin: '0 auto', background: 'linear-gradient(90deg, transparent, #c9184a, transparent)' }} />
      <div style={{ textAlign: 'center', padding: '8px 0', color: '#c9184a', fontSize: '10px', opacity: 0.3, letterSpacing: '12px' }}>♥ ♥ ♥</div>

      {/* PRICING */}
      <div style={{ padding: '80px 24px', maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#ff8fa3', fontWeight: 600, marginBottom: '12px' }}>
          ♥ &nbsp; Inversión
        </div>
        <h2 style={{
          textAlign: 'center', fontFamily: "'Playfair Display', serif",
          fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 400, marginBottom: '48px', lineHeight: 1.2
        }}>
          Un regalo que <em style={{ fontStyle: 'italic', color: '#c9184a' }}>no tiene precio</em>
        </h2>

        <div className="lpp-pricing-card" style={{
          maxWidth: '420px', margin: '0 auto', textAlign: 'center',
          background: 'linear-gradient(170deg, rgba(201,24,74,0.05) 0%, rgba(0,0,0,0) 60%)',
          border: '1px solid rgba(201,24,74,0.2)',
          borderRadius: '24px', padding: '48px 40px', position: 'relative', overflow: 'hidden'
        }}>
          {/* Top line accent */}
          <div style={{
            position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
            width: '120px', height: '1px', background: 'linear-gradient(90deg, transparent, #c9184a, transparent)'
          }} />
          {/* Rose glow */}
          <div style={{
            position: 'absolute', top: '-40%', left: '50%', transform: 'translateX(-50%)',
            width: '200%', height: '80%', borderRadius: '50%',
            background: 'radial-gradient(ellipse, rgba(201,24,74,0.04) 0%, transparent 70%)',
            pointerEvents: 'none'
          }} />

          <div style={{ fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#ff8fa3', marginBottom: '24px', fontWeight: 600, position: 'relative', zIndex: 1 }}>
            ♥ Canción de San Valentín ♥
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: '56px', fontWeight: 900, marginBottom: '4px', position: 'relative', zIndex: 1 }}>
            $29<span style={{ fontSize: '28px', color: 'rgba(255,255,255,0.4)' }}>.99</span>
          </div>
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', marginBottom: '32px', position: 'relative', zIndex: 1 }}>
            Pago único · Acceso de por vida
          </div>

          <ul style={{ listStyle: 'none', textAlign: 'left', marginBottom: '32px', position: 'relative', zIndex: 1, padding: 0 }}>
            {FEATURES.map((f, i) => (
              <li key={i} style={{
                padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
                fontSize: '14px', color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: '12px'
              }}>
                <span style={{ color: '#c9184a', fontSize: '8px' }}>♥</span> {f}
              </li>
            ))}
          </ul>

          <button className="lpp-cta-btn" onClick={handleCTA} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            width: '100%', padding: '16px', borderRadius: '999px', border: 'none',
            background: 'linear-gradient(135deg, #c9184a, #a01540)',
            color: 'white', fontSize: '15px', fontWeight: 800, cursor: 'pointer',
            transition: 'all 0.3s', letterSpacing: '0.02em',
            boxShadow: '0 4px 20px rgba(201,24,74,0.25)',
            position: 'relative', zIndex: 1
          }}>
            ♥ &nbsp; Crear Su Canción de Amor
          </button>

          {/* Combo */}
          <div style={{
            marginTop: '20px', padding: '16px', borderRadius: '12px',
            background: 'rgba(201,24,74,0.06)', border: '1px solid rgba(201,24,74,0.15)',
            position: 'relative', zIndex: 1
          }}>
            <div style={{ fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#ff8fa3', fontWeight: 600, marginBottom: '4px' }}>
              ♥ Paquete San Valentín
            </div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: '28px', fontWeight: 700 }}>
              $39<span style={{ fontSize: '18px', color: 'rgba(255,255,255,0.4)' }}>.99</span>{' '}
              <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.35)', fontWeight: 300, fontFamily: "'Plus Jakarta Sans'" }}>por 2 canciones</span>{' '}
              <span style={{
                display: 'inline-block', background: '#c9184a', color: 'white',
                fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                letterSpacing: '0.05em', marginLeft: '8px', verticalAlign: 'middle'
              }}>AHORRA $20</span>
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '4px' }}>
              Regala ambas versiones — el doble de emoción
            </div>
          </div>

          <p style={{
            marginTop: '16px', fontSize: '12px', color: 'rgba(255,255,255,0.25)',
            letterSpacing: '0.05em', position: 'relative', zIndex: 1
          }}>
            🔒 Preview gratis antes de pagar
          </p>
        </div>
      </div>

      {/* FINAL CTA */}
      <div style={{
        textAlign: 'center', padding: '100px 24px',
        background: 'linear-gradient(180deg, rgba(201,24,74,0.04) 0%, #0a0507 100%)',
        position: 'relative', overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '600px', height: '600px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(201,24,74,0.06) 0%, transparent 60%)',
          pointerEvents: 'none'
        }} />
        <span style={{
          fontSize: '48px', display: 'block', margin: '0 auto 20px',
          animation: 'lpp-heartbeat 1.4s ease-in-out infinite',
          filter: 'drop-shadow(0 0 20px rgba(201,24,74,0.3))'
        }}>♥</span>
        <h2 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: 400, marginBottom: '16px', position: 'relative'
        }}>
          San Valentín es<br />este <em style={{ fontStyle: 'italic', color: '#c9184a' }}>sábado</em>
        </h2>
        <p style={{
          fontSize: '16px', color: 'rgba(255,255,255,0.4)', maxWidth: '400px',
          margin: '0 auto 32px', lineHeight: 1.6, fontWeight: 300, position: 'relative'
        }}>
          Tu canción lista en minutos. El regalo más único y personal que puedes dar este 14 de febrero.
        </p>
        <button className="lpp-hero-cta" onClick={handleCTA} style={{
          display: 'inline-flex', alignItems: 'center', gap: '10px',
          background: 'linear-gradient(135deg, #c9184a, #a01540)',
          color: 'white', padding: '18px 48px', borderRadius: '999px', border: 'none',
          fontSize: '16px', fontWeight: 800, cursor: 'pointer',
          boxShadow: '0 8px 32px rgba(201,24,74,0.3)',
          transition: 'all 0.3s', letterSpacing: '0.02em', position: 'relative'
        }}>
          ♥ &nbsp; Crear Su Canción Ahora
        </button>
        <p style={{ marginTop: '16px', fontSize: '13px', color: 'rgba(255,255,255,0.2)', position: 'relative' }}>
          No necesitas experiencia musical. Solo cuéntanos su historia de amor.
        </p>
      </div>

      {/* FOOTER */}
      <div style={{
        padding: '24px 40px', textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        fontSize: '12px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.1em'
      }}>
        RegalosQueCantan &nbsp;·&nbsp; © {new Date().getFullYear()} &nbsp;·&nbsp; Hecho con ♥
      </div>
    </div>
  );
}
