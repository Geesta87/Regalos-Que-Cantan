import React, { useContext, useEffect, useState } from 'react';
import { AppContext } from '../App';

export default function AffiliateLanding() {
  const { navigateTo } = useContext(AppContext);
  const [selectedAudience, setSelectedAudience] = useState(25000);
  const [openFaq, setOpenFaq] = useState(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyForm, setApplyForm] = useState({ name: '', email: '', social: '', audience: '', message: '' });
  const [applyStatus, setApplyStatus] = useState('idle'); // idle, sending, sent, error

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

  const handleApply = async (e) => {
    e.preventDefault();
    setApplyStatus('sending');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/affiliate-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify(applyForm)
      });
      const data = await res.json();
      if (data.success) {
        setApplyStatus('sent');
      } else {
        setApplyStatus('error');
      }
    } catch {
      setApplyStatus('error');
    }
  };

  // Load Tailwind CDN + fonts dynamically for this page only
  useEffect(() => {
    const tailwindScript = document.createElement('script');
    tailwindScript.src = 'https://cdn.tailwindcss.com?plugins=forms,container-queries';
    tailwindScript.id = 'afl-tailwind';
    document.head.appendChild(tailwindScript);

    const configScript = document.createElement('script');
    configScript.id = 'afl-tailwind-config';
    configScript.textContent = `
      if(window.tailwind){tailwind.config={darkMode:"class",theme:{extend:{colors:{primary:"#d97706","on-primary":"#ffffff",secondary:"#e11d48",tertiary:"#059669",background:"#faf8f5",surface:"#ffffff","on-surface":"#292524","surface-variant":"#fff9f0","on-surface-variant":"#44403c",outline:"#d6d3d1",amber:{50:"#fffbeb",100:"#fef3c7",200:"#fde68a",400:"#fbbf24",500:"#f59e0b",600:"#d97706",700:"#b45309",800:"#92400e"},rose:{400:"#fb7185",500:"#f43f5e",600:"#e11d48"},stone:{50:"#fafaf9",100:"#f5f5f4",200:"#e7e5e4",300:"#d6d3d1",400:"#a8a29e",500:"#78716c",600:"#57534e",700:"#44403c",800:"#292524",900:"#1c1917"}},borderRadius:{DEFAULT:"0.75rem",lg:"1rem",xl:"1.5rem","2xl":"24px",full:"9999px"},fontFamily:{headline:["Lexend"],body:["Plus Jakarta Sans"],lexend:["Lexend"],jakarta:["Plus Jakarta Sans"]}}}}}
    `;
    document.head.appendChild(configScript);

    const fontsLink = document.createElement('link');
    fontsLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
    fontsLink.rel = 'stylesheet';
    fontsLink.id = 'afl-fonts';
    document.head.appendChild(fontsLink);

    return () => {
      document.getElementById('afl-tailwind')?.remove();
      document.getElementById('afl-tailwind-config')?.remove();
      document.getElementById('afl-fonts')?.remove();
    };
  }, []);

  const applyUrl = "mailto:hola@regalosquecantan.com?subject=Quiero%20ser%20afiliado%20de%20RegalosQueCantan&body=Hola%2C%20me%20interesa%20el%20programa%20de%20afiliados.%20Mi%20nombre%20es%20____%20y%20mi%20red%20social%20principal%20es%20____.";

  const audienceOptions = [
    { label: '1K', value: 1000 },
    { label: '5K', value: 5000 },
    { label: '10K', value: 10000 },
    { label: '25K', value: 25000 },
    { label: '50K', value: 50000 },
    { label: '100K', value: 100000 },
  ];

  const earningsMap = {
    1000: { sales: 4, earnings: 32 },
    5000: { sales: 20, earnings: 160 },
    10000: { sales: 40, earnings: 320 },
    25000: { sales: 100, earnings: 800 },
    50000: { sales: 200, earnings: 1600 },
    100000: { sales: 400, earnings: 3200 },
  };

  const currentEarnings = earningsMap[selectedAudience];

  const faqItems = [
    { q: 'Es gratis unirse?', a: 'Si, es 100% gratis. No hay costo de entrada, no necesitas tarjeta de credito, y no hay compromisos de ningun tipo.' },
    { q: 'Cuanto gano por cada venta?', a: 'Ganas el 20% de cada venta. Eso es $6.00 por cancion individual ($29.99), $8.00 por bundle ($39.99), o $10.00 por bundle + video ($49.99).' },
    { q: 'Cuando me pagan?', a: 'Los pagos se hacen mensualmente via Zelle, Venmo o PayPal. El minimo de pago es $20.' },
    { q: 'Que pasa con los reembolsos?', a: 'Si un cliente pide reembolso, la comision se revierte. Pero nuestra tasa de reembolso es menor al 2%, asi que es muy raro.' },
    { q: 'Tengo que lidiar con clientes?', a: 'Nunca. Nosotros manejamos absolutamente todo el servicio al cliente, soporte, y cualquier problema que surja.' },
    { q: 'Como se rastrean las ventas?', a: 'Cada partner recibe un link y codigo unico. Todas las ventas se rastrean automaticamente en tu dashboard.' },
    { q: 'Puedo ver mis datos en tiempo real?', a: 'Si, tienes acceso 24/7 a tu portal donde puedes ver visitantes, checkouts, ventas y comisiones en tiempo real.' },
    { q: 'Hay limite de ganancias?', a: 'No hay ningun limite. Mientras mas compartas, mas ganas. Sin techo.' },
  ];

  const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        ::selection { background: rgba(225,29,72,0.15); color: #111827; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes pulse-soft {
          0%, 100% { box-shadow: 0 0 0 0 rgba(225,29,72,0.2); }
          50% { box-shadow: 0 0 0 12px rgba(225,29,72,0); }
        }

        .afl-cta-btn {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }
        .afl-cta-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(225,29,72,0.3) !important;
        }
        .afl-cta-btn:active { transform: translateY(0); }
        .afl-cta-btn::after {
          content: '';
          position: absolute;
          top: 0; left: -100%; width: 60%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
          transition: left 0.5s;
        }
        .afl-cta-btn:hover::after { left: 200%; }

        .afl-audience-btn { transition: all 0.2s ease; }
        .afl-audience-btn:hover { background: #f3f4f6 !important; }

        .afl-faq-content {
          overflow: hidden;
          transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
        }

        .afl-card {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .afl-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 40px rgba(0,0,0,0.08) !important;
        }

        .afl-modal-input:focus {
          border-color: #e11d48 !important;
          box-shadow: 0 0 0 4px rgba(225,29,72,0.08) !important;
          outline: none;
        }

        .afl-gradient-text {
          background: linear-gradient(135deg, #e11d48, #7c3aed);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .afl-hero-orb-1 {
          position: absolute;
          top: -20%;
          right: -10%;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(225,29,72,0.06) 0%, transparent 70%);
          pointer-events: none;
        }
        .afl-hero-orb-2 {
          position: absolute;
          bottom: -30%;
          left: -15%;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(59,130,246,0.04) 0%, transparent 70%);
          pointer-events: none;
        }

        @media (max-width: 768px) {
          .afl-steps-grid { grid-template-columns: 1fr !important; }
          .afl-earn-grid { grid-template-columns: 1fr !important; }
          .afl-vs-grid { grid-template-columns: 1fr !important; }
          .afl-stat-pills { flex-direction: column !important; align-items: center !important; }
          .afl-audience-wrap { flex-wrap: wrap !important; }
          .afl-footer-wrap { flex-direction: column !important; text-align: center !important; }
          .afl-footer-links { justify-content: center !important; }
          .afl-hero-title { font-size: 2.2rem !important; }
          .afl-hero-orb-1, .afl-hero-orb-2 { display: none; }
        }
      `}</style>

      <div style={{ background: '#ffffff', color: '#111827', fontFamily: font, minHeight: '100vh', overflowX: 'hidden' }}>
        {/* Top gradient line */}
        <div style={{ height: '3px', background: 'linear-gradient(90deg, #e11d48, #7c3aed, #3b82f6, #e11d48)', backgroundSize: '200% 100%', animation: 'shimmer 3s linear infinite', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200 }} />

        {/* ============ NAV ============ */}
        <nav style={{
          position: 'sticky', top: 3, zIndex: 100,
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
          padding: '0 24px',
        }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' }}>
            <span style={{ fontFamily: font, fontSize: '18px', fontWeight: 800, color: '#111827' }}>
              Regalos<span style={{ color: '#e11d48' }}>QueCantan</span>
            </span>
            <button
              onClick={() => setShowApplyModal(true)}
              className="afl-cta-btn"
              style={{
                background: '#e11d48', color: '#fff',
                padding: '10px 24px', borderRadius: '9999px',
                fontSize: '14px', fontWeight: 600, fontFamily: font,
                border: 'none', cursor: 'pointer',
              }}
            >
              Aplicar
            </button>
          </div>
        </nav>

        {/* ============ HERO ============ */}
        <section style={{ background: '#fafbff', padding: 'clamp(80px, 12vw, 140px) 24px 100px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div className="afl-hero-orb-1" />
          <div className="afl-hero-orb-2" />
          <div style={{ maxWidth: '750px', margin: '0 auto', animation: 'fadeUp 0.8s ease-out', position: 'relative', zIndex: 1 }}>
            {/* Badge */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              background: '#ffffff', color: '#e11d48',
              padding: '8px 20px', borderRadius: '9999px',
              fontSize: '14px', fontWeight: 600, marginBottom: '28px',
              border: '1px solid rgba(225,29,72,0.12)',
              boxShadow: '0 2px 12px rgba(225,29,72,0.06)',
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e11d48', animation: 'pulse-soft 2s infinite' }} />
              Programa de Partners — Aplica Gratis
            </span>

            {/* Headline */}
            <h1 className="afl-hero-title" style={{
              fontFamily: font,
              fontSize: 'clamp(2.5rem, 6vw, 4rem)',
              fontWeight: 800, lineHeight: 1.1,
              marginBottom: '24px', color: '#111827',
              letterSpacing: '-0.03em',
            }}>
              Comparte tu link.<br /><span className="afl-gradient-text">Gana dinero.</span>
            </h1>

            {/* Subtitle */}
            <p style={{
              fontSize: 'clamp(16px, 2.5vw, 18px)',
              color: '#6b7280', lineHeight: 1.7,
              maxWidth: '540px', margin: '0 auto 36px',
            }}>
              Cada vez que alguien compra una cancion por tu link, tu ganas 20%. Nosotros hacemos todo lo demas.
            </p>

            {/* CTA */}
            <button
              onClick={() => setShowApplyModal(true)}
              className="afl-cta-btn"
              style={{
                background: '#e11d48', color: '#fff',
                padding: '16px 36px', borderRadius: '9999px',
                fontSize: '17px', fontWeight: 700, fontFamily: font,
                border: 'none', cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(225,29,72,0.2)',
                minHeight: '52px',
              }}
            >
              Quiero ser partner &rarr;
            </button>

            {/* Stat pills */}
            <div className="afl-stat-pills" style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '40px', flexWrap: 'wrap' }}>
              {[
                { emoji: '\uD83D\uDCB0', text: '$6-$10 por venta' },
                { emoji: '\uD83C\uDD93', text: 'Gratis para ti' },
                { emoji: '\uD83D\uDE4C', text: 'Cero esfuerzo' },
              ].map((pill, i) => (
                <span key={i} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  background: '#f9fafb', border: '1px solid #f3f4f6',
                  padding: '10px 20px', borderRadius: '9999px',
                  fontSize: '14px', fontWeight: 500, color: '#374151',
                }}>
                  <span>{pill.emoji}</span> {pill.text}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section style={{ background: '#ffffff', padding: '100px 24px' }}>
          <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
            <span style={{ display: 'inline-block', background: '#f0fdf4', color: '#059669', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: 600, marginBottom: '16px', border: '1px solid rgba(5,150,105,0.1)' }}>3 pasos simples</span>
            <h2 style={{ fontFamily: font, fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800, marginBottom: '56px', color: '#111827', letterSpacing: '-0.02em' }}>
              Asi de facil
            </h2>

            <div className="afl-steps-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '40px' }}>
              {[
                { num: '1', title: 'Crea tu cuenta', desc: 'Te registras gratis. Recibes tu link y codigo.' },
                { num: '2', title: 'Comparte', desc: 'Pon tu link en tu bio, stories, o videos.' },
                { num: '3', title: 'Gana', desc: 'Cada venta = dinero para ti. Pagos cada mes.' },
              ].map((step, i) => (
                <div key={i} className="afl-card" style={{
                  background: '#ffffff', borderRadius: '16px',
                  padding: '36px 24px', textAlign: 'center',
                  border: '1px solid #f3f4f6',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '16px',
                    background: 'linear-gradient(135deg, #e11d48, #7c3aed)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 20px',
                    fontFamily: font, fontSize: '22px', fontWeight: 800,
                    boxShadow: '0 4px 16px rgba(225,29,72,0.2)',
                  }}>
                    {step.num}
                  </div>
                  <h3 style={{ fontFamily: font, fontSize: '18px', fontWeight: 700, marginBottom: '8px', color: '#111827' }}>
                    {step.title}
                  </h3>
                  <p style={{ fontSize: '15px', color: '#6b7280', lineHeight: 1.6 }}>
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowApplyModal(true)}
              className="afl-cta-btn"
              style={{
                background: '#e11d48', color: '#fff',
                padding: '14px 32px', borderRadius: '9999px',
                fontSize: '16px', fontWeight: 600, fontFamily: font,
                border: 'none', cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(225,29,72,0.2)',
                minHeight: '48px',
              }}
            >
              Empezar ahora
            </button>
          </div>
        </section>

        {/* ============ WHAT YOU EARN ============ */}
        <section style={{ background: '#fafbff', padding: '100px 24px', position: 'relative' }}>
          <div style={{ maxWidth: '700px', margin: '0 auto', textAlign: 'center' }}>
            <span style={{ display: 'inline-block', background: '#fff7ed', color: '#d97706', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: 600, marginBottom: '16px', border: '1px solid rgba(217,119,6,0.1)' }}>💰 Calculadora</span>
            <h2 style={{ fontFamily: font, fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800, marginBottom: '48px', color: '#111827', letterSpacing: '-0.02em' }}>
              Cuanto puedes ganar?
            </h2>

            {/* Price cards */}
            <div className="afl-earn-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '40px', maxWidth: '500px', margin: '0 auto 40px' }}>
              <div className="afl-card" style={{
                background: '#ffffff', borderRadius: '16px', padding: '24px',
                border: '1px solid #f3f4f6', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>Cancion $29.99</p>
                <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>&darr;</p>
                <p style={{ fontSize: '24px', fontWeight: 800, color: '#059669', fontFamily: font }}>Tu ganas $6.00</p>
              </div>
              <div className="afl-card" style={{
                background: '#ffffff', borderRadius: '16px', padding: '24px',
                border: '1px solid #f3f4f6', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>Bundle $39.99</p>
                <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>&darr;</p>
                <p style={{ fontSize: '24px', fontWeight: 800, color: '#059669', fontFamily: font }}>Tu ganas $8.00</p>
              </div>
            </div>

            {/* Audience selector */}
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px', fontWeight: 500 }}>Tamano de tu audiencia:</p>
            <div className="afl-audience-wrap" style={{
              display: 'inline-flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px',
              padding: '6px', borderRadius: '9999px',
              background: '#f3f4f6', marginBottom: '28px',
            }}>
              {audienceOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedAudience(opt.value)}
                  className="afl-audience-btn"
                  style={{
                    padding: '10px 22px',
                    borderRadius: '9999px',
                    border: 'none',
                    background: selectedAudience === opt.value ? '#e11d48' : 'transparent',
                    color: selectedAudience === opt.value ? '#fff' : '#6b7280',
                    fontFamily: font,
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: 'pointer',
                    minHeight: '44px',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Results */}
            <div style={{
              background: '#ffffff', borderRadius: '20px', padding: '36px 24px',
              border: '1px solid #f3f4f6', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              maxWidth: '400px', margin: '0 auto',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Tu audiencia</p>
                  <p style={{ fontFamily: font, fontWeight: 700, fontSize: '18px', color: '#111827' }}>{selectedAudience.toLocaleString()}</p>
                </div>
                <div>
                  <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>Ventas/mes</p>
                  <p style={{ fontFamily: font, fontWeight: 700, fontSize: '18px', color: '#111827' }}>{currentEarnings.sales}</p>
                </div>
              </div>
              <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '20px' }}>
                <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '8px' }}>Ganancias mensuales estimadas</p>
                <p style={{
                  fontFamily: font,
                  fontSize: 'clamp(2.5rem, 8vw, 3.5rem)',
                  fontWeight: 800, color: '#059669',
                  transition: 'all 0.3s ease',
                }}>
                  ${currentEarnings.earnings.toLocaleString()}
                </p>
              </div>
            </div>

            <p style={{ fontSize: '14px', color: '#9ca3af', marginTop: '20px', fontStyle: 'italic' }}>
              Sin limite. Mientras mas compartes, mas ganas.
            </p>
          </div>
        </section>

        {/* ============ YOU VS US ============ */}
        <section style={{ background: '#ffffff', padding: '100px 24px' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
            <span style={{ display: 'inline-block', background: '#eff6ff', color: '#2563eb', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: 600, marginBottom: '16px', border: '1px solid rgba(37,99,235,0.1)' }}>🤝 Sin esfuerzo</span>
            <h2 style={{ fontFamily: font, fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800, marginBottom: '12px', color: '#111827', letterSpacing: '-0.02em' }}>
              Tu compartes. Nosotros hacemos todo.
            </h2>
            <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '48px', maxWidth: '500px', margin: '0 auto 48px' }}>La colaboracion mas facil que vas a tener. Mira la diferencia:</p>

            <div className="afl-vs-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', textAlign: 'left' }}>
              {/* What YOU do */}
              <div className="afl-card" style={{
                background: '#ffffff', borderRadius: '16px', padding: '32px 28px',
                border: '1px solid #f3f4f6', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <h3 style={{ fontFamily: font, fontSize: '17px', fontWeight: 700, marginBottom: '24px', color: '#111827' }}>
                  Lo que tu haces
                </h3>
                {[
                  'Compartes tu link unico',
                  'Recomiendas el producto',
                  'Recibes tu 20% automaticamente',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '16px' }}>
                    <span style={{ color: '#059669', fontSize: '18px', lineHeight: 1.3, flexShrink: 0 }}>&#10003;</span>
                    <span style={{ fontSize: '15px', color: '#374151', lineHeight: 1.6 }}>{item}</span>
                  </div>
                ))}
              </div>

              {/* What WE do */}
              <div className="afl-card" style={{
                background: 'linear-gradient(135deg, #fafbff, #f0f4ff)', borderRadius: '20px', padding: '32px 28px',
                border: '2px solid rgba(37,99,235,0.1)', boxShadow: '0 4px 20px rgba(37,99,235,0.06)',
              }}>
                <h3 style={{ fontFamily: font, fontSize: '17px', fontWeight: 700, marginBottom: '24px', color: '#111827' }}>
                  Lo que nosotros hacemos
                </h3>
                {[
                  'Creamos la cancion personalizada',
                  'Cobramos al cliente',
                  'Entregamos el producto',
                  'Damos soporte al cliente',
                  'Manejamos reembolsos',
                  'Te pagamos tu comision',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '16px' }}>
                    <span style={{ color: '#059669', fontSize: '18px', lineHeight: 1.3, flexShrink: 0 }}>&#10003;</span>
                    <span style={{ fontSize: '15px', color: '#374151', lineHeight: 1.6 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ fontSize: '15px', color: '#9ca3af', fontStyle: 'italic', marginTop: '32px' }}>
              Literalmente no hay nada mas que hacer.
            </p>
          </div>
        </section>

        {/* ============ SOCIAL PROOF ============ */}
        <section style={{ background: '#111827', padding: '48px 24px' }}>
          <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', justifyContent: 'center', gap: '40px', flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { num: '10,000+', label: 'canciones' },
              { num: '4.9/5', label: 'estrellas' },
              { num: '20+', label: 'generos' },
              { num: '94%', label: 'satisfaccion' },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: font, fontSize: '24px', fontWeight: 800, color: '#ffffff', marginBottom: '2px' }}>{s.num}</div>
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ============ FAQ ============ */}
        <section style={{ background: '#fafbff', padding: '100px 24px' }}>
          <div style={{ maxWidth: '650px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: '48px' }}>
              <span style={{ display: 'inline-block', background: '#fef3c7', color: '#92400e', padding: '6px 16px', borderRadius: '9999px', fontSize: '13px', fontWeight: 600, marginBottom: '16px', border: '1px solid rgba(146,64,14,0.1)' }}>❓ FAQ</span>
              <h2 style={{ fontFamily: font, fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800, color: '#111827', letterSpacing: '-0.02em' }}>
                Preguntas frecuentes
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {faqItems.map((faq, i) => (
                <div key={i} style={{
                  background: '#ffffff', borderRadius: '12px', overflow: 'hidden',
                  border: '1px solid #f3f4f6',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}>
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    style={{
                      width: '100%',
                      padding: '18px 20px',
                      background: 'transparent',
                      border: 'none',
                      color: '#111827',
                      fontSize: '15px',
                      fontWeight: 600,
                      fontFamily: font,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      textAlign: 'left',
                      minHeight: '48px',
                    }}
                  >
                    <span>{faq.q}</span>
                    <span style={{
                      color: '#e11d48', fontSize: '20px', fontWeight: 400,
                      flexShrink: 0, marginLeft: '16px',
                      transform: openFaq === i ? 'rotate(45deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease',
                      display: 'inline-block',
                    }}>+</span>
                  </button>
                  <div className="afl-faq-content" style={{ maxHeight: openFaq === i ? '200px' : '0px', opacity: openFaq === i ? 1 : 0 }}>
                    <div style={{ padding: '0 20px 18px', color: '#6b7280', fontSize: '15px', lineHeight: 1.7 }}>
                      {faq.a}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ FINAL CTA ============ */}
        <section style={{ background: '#ffffff', padding: '100px 24px' }}>
          <div style={{
            maxWidth: '580px', margin: '0 auto', textAlign: 'center',
            background: 'linear-gradient(135deg, #fef2f2, #faf5ff, #eff6ff)', borderRadius: '28px', padding: '60px 40px',
            border: '1px solid rgba(225,29,72,0.08)',
            boxShadow: '0 8px 40px rgba(225,29,72,0.06)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #e11d48, #7c3aed, #3b82f6)' }} />
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🚀</div>
            <h2 style={{ fontFamily: font, fontSize: 'clamp(1.6rem, 4vw, 2.2rem)', fontWeight: 800, marginBottom: '16px', color: '#111827', lineHeight: 1.3, letterSpacing: '-0.02em' }}>
              Listo? Es gratis y toma 2 minutos.
            </h2>

            <button
              onClick={() => setShowApplyModal(true)}
              className="afl-cta-btn"
              style={{
                background: '#e11d48', color: '#fff',
                padding: '16px 36px', borderRadius: '9999px',
                fontSize: '17px', fontWeight: 700, fontFamily: font,
                border: 'none', cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(225,29,72,0.2)',
                minHeight: '52px',
                marginBottom: '16px',
              }}
            >
              Quiero ser partner &rarr;
            </button>

            <p style={{ fontSize: '13px', color: '#9ca3af' }}>
              Sin contratos &middot; Sin compromiso &middot; Nosotros hacemos todo
            </p>
          </div>
        </section>

        {/* ============ FOOTER ============ */}
        <footer style={{ background: '#f9fafb', padding: '40px 24px', borderTop: '1px solid #f3f4f6' }}>
          <div className="afl-footer-wrap" style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontFamily: font, fontSize: '16px', fontWeight: 700, color: '#111827' }}>
                Regalos<span style={{ color: '#e11d48' }}>QueCantan</span>
              </span>
            </div>

            <div className="afl-footer-links" style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => navigateTo('affiliateTerms')} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '14px', cursor: 'pointer', fontFamily: font }}>Terminos</button>
              <button onClick={() => navigateTo('affiliateLogin')} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '14px', cursor: 'pointer', fontFamily: font }}>Portal de Partners</button>
              <a href="mailto:hola@regalosquecantan.com" style={{ color: '#6b7280', fontSize: '14px', textDecoration: 'none' }}>hola@regalosquecantan.com</a>
            </div>
          </div>
          <div style={{ maxWidth: '900px', margin: '20px auto 0', textAlign: 'center' }}>
            <p style={{ color: '#9ca3af', fontSize: '13px' }}>&copy; 2026 RegalosQueCantan. Todos los derechos reservados.</p>
          </div>
        </footer>

        {/* ============ APPLY MODAL ============ */}
        {showApplyModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => { if (applyStatus !== 'sending') setShowApplyModal(false); }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
            <div style={{ position: 'relative', maxWidth: '440px', width: '100%', animation: 'fadeUp 0.3s ease-out' }} onClick={e => e.stopPropagation()}>
              <div style={{ background: '#ffffff', borderRadius: '20px', padding: '36px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
                {applyStatus === 'sent' ? (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>{'\uD83C\uDF89'}</div>
                    <h3 style={{ fontFamily: font, fontSize: '22px', fontWeight: 700, marginBottom: '10px', color: '#111827' }}>Solicitud recibida!</h3>
                    <p style={{ color: '#6b7280', lineHeight: 1.7, marginBottom: '24px', fontSize: '15px' }}>
                      Te contactaremos pronto con los detalles de tu cuenta. Revisa tu email.
                    </p>
                    <button onClick={() => { setShowApplyModal(false); setApplyStatus('idle'); setApplyForm({ name: '', email: '', social: '', audience: '', message: '' }); }} className="afl-cta-btn" style={{ background: '#e11d48', color: '#fff', padding: '12px 28px', borderRadius: '9999px', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: font, fontSize: '15px', boxShadow: '0 4px 14px rgba(225,29,72,0.2)' }}>
                      Cerrar
                    </button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => setShowApplyModal(false)} style={{ position: 'absolute', top: '14px', right: '14px', background: 'none', border: 'none', color: '#9ca3af', fontSize: '22px', cursor: 'pointer', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
                    <h3 style={{ fontFamily: font, fontSize: '22px', fontWeight: 700, marginBottom: '6px', color: '#111827' }}>Aplica como Partner</h3>
                    <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '24px' }}>100% gratis. Te contactamos en menos de 24 horas.</p>
                    <form onSubmit={handleApply} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <input type="text" placeholder="Tu nombre completo" required value={applyForm.name} onChange={e => setApplyForm({...applyForm, name: e.target.value})} className="afl-modal-input" style={{ padding: '13px 16px', borderRadius: '12px', border: '1px solid #e5e7eb', background: '#ffffff', color: '#111827', fontSize: '15px', outline: 'none', fontFamily: font, minHeight: '48px', transition: 'border-color 0.2s, box-shadow 0.2s' }} />
                      <input type="email" placeholder="Tu email" required value={applyForm.email} onChange={e => setApplyForm({...applyForm, email: e.target.value})} className="afl-modal-input" style={{ padding: '13px 16px', borderRadius: '12px', border: '1px solid #e5e7eb', background: '#ffffff', color: '#111827', fontSize: '15px', outline: 'none', fontFamily: font, minHeight: '48px', transition: 'border-color 0.2s, box-shadow 0.2s' }} />
                      <input type="text" placeholder="Tu red social principal (ej: @tucuenta)" value={applyForm.social} onChange={e => setApplyForm({...applyForm, social: e.target.value})} className="afl-modal-input" style={{ padding: '13px 16px', borderRadius: '12px', border: '1px solid #e5e7eb', background: '#ffffff', color: '#111827', fontSize: '15px', outline: 'none', fontFamily: font, minHeight: '48px', transition: 'border-color 0.2s, box-shadow 0.2s' }} />
                      <input type="text" placeholder="Tamano de tu audiencia (ej: 10K)" value={applyForm.audience} onChange={e => setApplyForm({...applyForm, audience: e.target.value})} className="afl-modal-input" style={{ padding: '13px 16px', borderRadius: '12px', border: '1px solid #e5e7eb', background: '#ffffff', color: '#111827', fontSize: '15px', outline: 'none', fontFamily: font, minHeight: '48px', transition: 'border-color 0.2s, box-shadow 0.2s' }} />
                      <textarea placeholder="Algo que quieras decirnos? (opcional)" rows={3} value={applyForm.message} onChange={e => setApplyForm({...applyForm, message: e.target.value})} className="afl-modal-input" style={{ padding: '13px 16px', borderRadius: '12px', border: '1px solid #e5e7eb', background: '#ffffff', color: '#111827', fontSize: '15px', outline: 'none', fontFamily: font, resize: 'vertical', transition: 'border-color 0.2s, box-shadow 0.2s' }} />
                      {applyStatus === 'error' && <p style={{ color: '#ef4444', fontSize: '13px', margin: 0 }}>Hubo un error. Intenta de nuevo.</p>}
                      <button type="submit" disabled={applyStatus === 'sending'} className="afl-cta-btn" style={{ background: '#e11d48', color: '#fff', padding: '14px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 700, fontFamily: font, fontSize: '16px', opacity: applyStatus === 'sending' ? 0.7 : 1, boxShadow: '0 4px 14px rgba(225,29,72,0.2)', minHeight: '48px' }}>
                        {applyStatus === 'sending' ? 'Enviando...' : 'Enviar solicitud \u2192'}
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
