import React, { useContext } from 'react';
import { AppContext } from '../App';

export default function AffiliateVSL() {
  const { navigateTo } = useContext(AppContext);
  const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const phoneNumber = '2136666619';
  const whatsappLink = `https://wa.me/1${phoneNumber}?text=Hola%20Gerardo%2C%20vi%20tu%20video%20y%20quiero%20saber%20mas%20sobre%20el%20programa%20de%20partners`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer-bar {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes pulse-soft {
          0%, 100% { box-shadow: 0 0 0 0 rgba(225,29,72,0.3); }
          50% { box-shadow: 0 0 0 14px rgba(225,29,72,0); }
        }

        .vsl-contact-btn {
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }
        .vsl-contact-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(0,0,0,0.12) !important;
        }

        @media (max-width: 640px) {
          .vsl-hero-title { font-size: 1.6rem !important; }
          .vsl-contact-grid { grid-template-columns: 1fr !important; }
          .vsl-section { padding: 24px 16px 60px !important; }
          .vsl-contact-btn { padding: 18px 16px !important; }
          .vsl-phone-display { font-size: 22px !important; }
          .vsl-rewards-card { padding: 18px 14px !important; }
          .vsl-selling-card { padding: 14px !important; gap: 12px !important; }
          .vsl-selling-icon { width: 40px !important; height: 40px !important; font-size: 20px !important; }
          .vsl-selling-title { font-size: 14px !important; }
          .vsl-selling-desc { font-size: 12.5px !important; }
          .vsl-reward-row { padding: 10px 12px !important; }
          .vsl-reward-title { font-size: 12.5px !important; white-space: normal !important; }
          .vsl-reward-amount { font-size: 14px !important; }
          .vsl-rewards-total { font-size: 20px !important; }
          .vsl-heading { font-size: 19px !important; }
          .vsl-subheading { font-size: 18px !important; }
        }
        @media (max-width: 380px) {
          .vsl-section { padding: 20px 14px 50px !important; }
          .vsl-contact-grid { gap: 10px !important; }
          .vsl-phone-label { font-size: 10px !important; }
          .vsl-phone-value { font-size: 13px !important; }
        }
      `}</style>

      <div style={{ background: '#fffaf5', color: '#1c1917', fontFamily: font, minHeight: '100vh' }}>
        {/* Top gradient bar */}
        <div style={{ height: '3px', background: 'linear-gradient(90deg, #e11d48, #7c3aed, #3b82f6, #e11d48)', backgroundSize: '200% 100%', animation: 'shimmer-bar 3s linear infinite', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100 }} />

        {/* Minimal nav */}
        <nav style={{ padding: '18px 24px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontFamily: font, fontSize: '18px', fontWeight: 800, color: '#1c1917' }}>
            Regalos<span style={{ color: '#e11d48' }}>QueCantan</span>
          </span>
        </nav>

        {/* ============ MAIN CONTENT ============ */}
        <section className="vsl-section" style={{ maxWidth: '680px', margin: '0 auto', padding: '30px 24px 80px' }}>
          {/* Personal greeting */}
          <div style={{ textAlign: 'center', marginBottom: '28px', animation: 'fadeUp 0.6s ease-out' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'linear-gradient(135deg, #f97316, #e11d48)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '18px', fontFamily: font, boxShadow: '0 6px 20px rgba(249,115,22,0.3)' }}>
                G
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>Mensaje de</p>
                <p style={{ fontSize: '15px', color: '#1c1917', fontWeight: 700, margin: 0 }}>Gerardo — Fundador</p>
              </div>
            </div>

            <h1 className="vsl-hero-title" style={{
              fontFamily: font, fontSize: 'clamp(1.6rem, 4.5vw, 2.2rem)',
              fontWeight: 800, lineHeight: 1.25, marginBottom: '12px',
              color: '#1c1917', letterSpacing: '-0.02em',
            }}>
              Mira este video 👇
            </h1>
            <p style={{ fontSize: '15px', color: '#78716c', lineHeight: 1.6 }}>
              Te explico todo en 5 minutos
            </p>
          </div>

          {/* ============ VIDEO ============ */}
          <div style={{
            position: 'relative', borderRadius: '24px', overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(225,110,73,0.15), 0 4px 12px rgba(0,0,0,0.06)',
            border: '1px solid #fde8d4',
            aspectRatio: '16/9',
            background: '#1c1917',
            marginBottom: '40px',
            animation: 'fadeUp 0.8s ease-out 0.1s both',
          }}>
            <iframe
              src="https://www.youtube.com/embed/MK8XSTK_a_0?rel=0&modestbranding=1&start=2"
              title="Mensaje personal de Gerardo"
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>

          {/* ============ CONTACT SECTION ============ */}
          <div style={{ textAlign: 'center', animation: 'fadeUp 0.8s ease-out 0.2s both' }}>
            <h2 className="vsl-heading" style={{ fontFamily: font, fontSize: '22px', fontWeight: 800, color: '#1c1917', marginBottom: '8px', letterSpacing: '-0.01em' }}>
              ¿Te interesa? Contáctame directamente
            </h2>
            <p style={{ fontSize: '14px', color: '#78716c', marginBottom: '28px' }}>
              Escríbenos por WhatsApp o llámanos. Te contestamos personalmente.
            </p>

            {/* Contact buttons */}
            <div className="vsl-contact-grid" style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '14px',
              marginBottom: '28px',
            }}>
              {/* WhatsApp */}
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="vsl-contact-btn"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                  background: 'linear-gradient(135deg, #25d366, #128c7e)',
                  color: '#fff',
                  padding: '22px 20px',
                  borderRadius: '18px',
                  textDecoration: 'none',
                  fontWeight: 700, fontSize: '16px', fontFamily: font,
                  boxShadow: '0 8px 24px rgba(37,211,102,0.25)',
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                <div style={{ textAlign: 'left' }}>
                  <div className="vsl-phone-label" style={{ fontSize: '11px', opacity: 0.9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>WhatsApp</div>
                  <div className="vsl-phone-value" style={{ fontSize: '15px', fontWeight: 700 }}>Enviar mensaje</div>
                </div>
              </a>

              {/* Phone */}
              <a
                href={`tel:+1${phoneNumber}`}
                className="vsl-contact-btn"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                  background: 'linear-gradient(135deg, #e11d48, #f43f5e)',
                  color: '#fff',
                  padding: '22px 20px',
                  borderRadius: '18px',
                  textDecoration: 'none',
                  fontWeight: 700, fontSize: '16px', fontFamily: font,
                  boxShadow: '0 8px 24px rgba(225,29,72,0.25)',
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                <div style={{ textAlign: 'left' }}>
                  <div className="vsl-phone-label" style={{ fontSize: '11px', opacity: 0.9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Llámame</div>
                  <div className="vsl-phone-value" style={{ fontSize: '15px', fontWeight: 700 }}>(213) 666-6619</div>
                </div>
              </a>
            </div>

            {/* Direct phone number display */}
            <div style={{
              background: '#fff',
              borderRadius: '16px',
              padding: '20px',
              border: '1px dashed #fde8d4',
              marginBottom: '36px',
            }}>
              <p style={{ fontSize: '12px', color: '#a8a29e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                📞 Mi número directo
              </p>
              <a href={`tel:+1${phoneNumber}`} className="vsl-phone-display" style={{ fontFamily: font, fontSize: '26px', fontWeight: 800, color: '#1c1917', textDecoration: 'none', letterSpacing: '-0.5px' }}>
                (213) 666-6619
              </a>
              <p style={{ fontSize: '13px', color: '#78716c', marginTop: '6px' }}>
                Disponible de lunes a viernes
              </p>
            </div>

            {/* ============ STRONG SELLING POINTS ============ */}
            <div style={{ marginBottom: '36px' }}>
              <h3 className="vsl-subheading" style={{ fontFamily: font, fontSize: '20px', fontWeight: 800, color: '#1c1917', marginBottom: '20px', letterSpacing: '-0.01em' }}>
                ¿Por qué deberías considerarlo?
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
                {[
                  { icon: '🆓', title: 'Cero costo para ti', desc: 'No pagas absolutamente nada. Sin tarjeta. Sin compromisos.' },
                  { icon: '🙌', title: 'Tú no haces nada', desc: 'Solo compartes tu link. Eso es todo. En serio.' },
                  { icon: '🤝', title: 'Nosotros nos encargamos de TODO', desc: 'Creamos la canción, cobramos al cliente, damos soporte, manejamos reembolsos.' },
                  { icon: '💵', title: 'Tú solo ganas dinero', desc: 'Cada venta = 20% para ti. Pago mensual. Sin letra chica.' },
                ].map((item, i) => (
                  <div key={i} className="vsl-selling-card" style={{
                    background: '#fff',
                    borderRadius: '14px',
                    padding: '16px 18px',
                    border: '1px solid #fde8d4',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    boxShadow: '0 2px 8px rgba(225,110,73,0.04)',
                  }}>
                    <div className="vsl-selling-icon" style={{
                      width: '44px', height: '44px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '22px',
                      flexShrink: 0,
                    }}>
                      {item.icon}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="vsl-selling-title" style={{ fontFamily: font, fontSize: '15px', fontWeight: 700, color: '#1c1917', marginBottom: '2px' }}>{item.title}</div>
                      <div className="vsl-selling-desc" style={{ fontSize: '13px', color: '#78716c', lineHeight: 1.5 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ============ DAILY REWARDS VISUAL ============ */}
            <div className="vsl-rewards-card" style={{
              background: '#fff',
              borderRadius: '20px',
              padding: '24px',
              border: '1px solid #fde8d4',
              boxShadow: '0 4px 24px rgba(225,110,73,0.06)',
              marginBottom: '36px',
              textAlign: 'left',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px dashed #fde8d4' }}>
                <div>
                  <p style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>Recompensas de hoy</p>
                  <p style={{ fontSize: '13px', color: '#78716c' }}>Esto podría ser tu día</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 600, marginBottom: '2px' }}>Total ganado</p>
                  <p className="vsl-rewards-total" style={{ fontFamily: font, fontSize: '22px', fontWeight: 800, color: '#059669', letterSpacing: '-0.5px' }}>+$56.00</p>
                </div>
              </div>

              {/* Rewards list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { time: '9:14 AM', type: 'Canción para mamá', amount: '+$6.00', icon: '🎵' },
                  { time: '10:42 AM', type: 'Bundle de aniversario', amount: '+$8.00', icon: '🎶' },
                  { time: '11:28 AM', type: 'Canción de cumpleaños', amount: '+$6.00', icon: '🎵' },
                  { time: '1:05 PM', type: 'Bundle + Video', amount: '+$10.00', icon: '🎬' },
                  { time: '2:33 PM', type: 'Canción para boda', amount: '+$6.00', icon: '🎵' },
                  { time: '4:17 PM', type: 'Bundle de quinceañera', amount: '+$8.00', icon: '🎶' },
                  { time: '6:48 PM', type: 'Canción romántica', amount: '+$12.00', icon: '🎵', highlight: true },
                ].map((r, i) => (
                  <div key={i} className="vsl-reward-row" style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    background: r.highlight ? '#f0fdf4' : '#fef6ed',
                    border: `1px solid ${r.highlight ? '#bbf7d0' : '#fde8d4'}`,
                    gap: '10px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '18px', flexShrink: 0 }}>{r.icon}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p className="vsl-reward-title" style={{ fontSize: '13px', fontWeight: 600, color: '#1c1917', lineHeight: 1.3 }}>{r.type}</p>
                        <p style={{ fontSize: '11px', color: '#a8a29e', marginTop: '2px' }}>{r.time}</p>
                      </div>
                    </div>
                    <span className="vsl-reward-amount" style={{
                      fontFamily: font,
                      fontSize: '15px',
                      fontWeight: 800,
                      color: r.highlight ? '#059669' : '#e11d48',
                      flexShrink: 0,
                    }}>
                      {r.amount}
                    </span>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: '12px', color: '#a8a29e', textAlign: 'center', marginTop: '14px', fontStyle: 'italic' }}>
                7 ventas hoy · y el día aún no termina ✨
              </p>
            </div>

            <p style={{ fontSize: '13px', color: '#a8a29e', fontStyle: 'italic' }}>
              Gracias por tu tiempo ❤️ — Gerardo
            </p>
          </div>
        </section>

        {/* Footer — minimal */}
        <footer style={{ padding: '24px', textAlign: 'center', borderTop: '1px solid #fde8d4' }}>
          <span style={{ fontFamily: font, fontSize: '13px', fontWeight: 700, color: '#78716c' }}>
            Regalos<span style={{ color: '#e11d48' }}>QueCantan</span>
          </span>
          <p style={{ color: '#d6d3d1', fontSize: '11px', marginTop: '6px' }}>© 2026</p>
        </footer>
      </div>
    </>
  );
}
