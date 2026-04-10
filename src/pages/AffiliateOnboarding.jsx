import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

const css = `
@keyframes aff-fade-up {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes aff-scale-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes aff-float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}
.aff-ob-bg {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f2b4a 0%, #1a3d6e 30%, #1e4d8a 60%, #1a3d6e 100%);
  font-family: 'Inter', 'Nunito', -apple-system, BlinkMacSystemFont, sans-serif;
  padding: 20px;
  position: relative;
  overflow: hidden;
}
.aff-ob-bg::before {
  content: '';
  position: absolute;
  top: -40%;
  right: -20%;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(74,158,255,0.1) 0%, transparent 70%);
}
.aff-ob-card {
  position: relative;
  background: #ffffff;
  border-radius: 28px;
  padding: 48px 44px;
  width: 100%;
  max-width: 540px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.15);
  animation: aff-fade-up 0.6s ease-out;
}
.aff-ob-step { animation: aff-fade-up 0.5s ease-out; }
.aff-ob-btn {
  width: 100%;
  padding: 18px;
  border-radius: 16px;
  border: none;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.3px;
  transition: transform 0.2s, box-shadow 0.2s;
  box-shadow: 0 8px 24px rgba(37,99,235,0.3);
  font-family: inherit;
  margin-top: 12px;
}
.aff-ob-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(37,99,235,0.4); }
.aff-ob-benefit {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 18px 20px;
  background: #f0f7ff;
  border-radius: 16px;
  border: 1px solid #dbeafe;
  transition: background 0.3s, border-color 0.3s;
}
.aff-ob-benefit:hover {
  background: #e0efff;
  border-color: #93c5fd;
}
.aff-ob-tool-card {
  background: #f0f7ff;
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 16px;
  border: 1px solid #dbeafe;
  text-align: left;
}
.aff-ob-tool-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.aff-ob-tool-code {
  flex: 1;
  padding: 12px 16px;
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  font-size: 13px;
  color: #1e3a5f;
  word-break: break-all;
  font-family: 'JetBrains Mono', monospace, monospace;
}
.aff-ob-copy-btn {
  padding: 12px 20px;
  border-radius: 10px;
  border: 1px solid #93c5fd;
  background: #eff6ff;
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s;
  font-family: inherit;
}
.aff-ob-copy-btn:hover { background: #dbeafe; border-color: #60a5fa; }
`;

export default function AffiliateOnboarding() {
  const { navigateTo } = useContext(AppContext);
  const [affiliate, setAffiliate] = useState(null);
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const auth = localStorage.getItem('rqc_affiliate_auth');
    if (!auth) { navigateTo('affiliateLogin'); return; }
    try {
      const data = JSON.parse(auth);
      if (!data.affiliate) throw new Error();
      setAffiliate(data.affiliate);
    } catch { navigateTo('affiliateLogin'); }
  }, []);

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const completeOnboarding = async () => {
    // Persist server-side first so future logins skip onboarding even from a new device
    try {
      const auth = JSON.parse(localStorage.getItem('rqc_affiliate_auth'));
      if (auth?.token) {
        await fetch(`${SUPABASE_URL}/functions/v1/affiliate-complete-onboarding`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.token}`,
            'apikey': SUPABASE_ANON_KEY
          }
        });
      }
      // Mirror locally so the redirect on this device skips onboarding immediately
      auth.affiliate.onboarded = true;
      localStorage.setItem('rqc_affiliate_auth', JSON.stringify(auth));
    } catch { /* ignore — local mirror still updated below */ }
    navigateTo('affiliateDashboard');
  };

  if (!affiliate) return null;
  const affiliateLink = `https://regalosquecantan.com/?ref=${affiliate.code}`;
  const firstName = affiliate.name.split(' ')[0];

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="aff-ob-step" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 72, marginBottom: 16, animation: 'aff-float 3s ease-in-out infinite' }}>🎉</div>
      <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px', color: '#1e3a5f', lineHeight: 1.2 }}>
        Bienvenido, <span style={{ color: '#2563eb' }}>{firstName}</span>
      </h1>
      <p style={{ fontSize: 16, color: '#64748b', lineHeight: 1.7, margin: '16px 0 0' }}>
        Nos emociona tenerte como parte del equipo de <strong style={{ color: '#1e3a5f' }}>RegalosQueCantan</strong>.
        Juntos vamos a crear momentos inolvidables.
      </p>
      <button onClick={() => setStep(1)} className="aff-ob-btn" style={{ marginTop: 32 }}>Empezar</button>
    </div>,

    // Step 1: What we do
    <div key="whatwedo" className="aff-ob-step" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 12, animation: 'aff-scale-in 0.5s ease-out' }}>🎵</div>
      <h2 style={{ fontSize: 28, fontWeight: 800, color: '#1e3a5f', margin: '0 0 16px' }}>¿Que es RegalosQueCantan?</h2>
      <p style={{ fontSize: 16, color: '#64748b', lineHeight: 1.8, margin: '0 0 24px' }}>
        Creamos <strong style={{ color: '#2563eb' }}>canciones personalizadas</strong> para cualquier ocasion: cumpleanos, aniversarios, dia de las madres, bodas, graduaciones, quinceañeras, y mucho mas.
      </p>
      <div style={{ background: '#eff6ff', borderRadius: 16, padding: '24px 28px', border: '1px solid #bfdbfe', marginBottom: 24 }}>
        <p style={{ fontSize: 15, color: '#475569', margin: 0, lineHeight: 1.7 }}>
          Cada cancion es <strong style={{ color: '#1d4ed8' }}>unica</strong> — con los nombres, la historia y los detalles del cliente. El elige el genero musical, nos cuenta su historia, y en minutos tiene una cancion profesional lista para regalar.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        {['Corridos', 'Cumbia', 'Balada', 'Reggaeton', 'Banda', 'Bachata', 'Norteno', 'Ranchera', 'Salsa', 'Mariachi', 'Pop Latino', '+10 mas'].map(g => (
          <span key={g} style={{ padding: '6px 16px', borderRadius: 20, background: g === '+10 mas' ? '#2563eb' : '#f0f7ff', border: `1px solid ${g === '+10 mas' ? '#2563eb' : '#dbeafe'}`, color: g === '+10 mas' ? '#ffffff' : '#475569', fontSize: 12, fontWeight: 600 }}>{g}</span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
        {[
          { num: '500+', label: 'Canciones creadas' },
          { num: '4.9/5', label: 'Satisfaccion' },
          { num: '~3 min', label: 'Tiempo de creacion' },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center', padding: '16px 8px', background: '#f8fafc', borderRadius: 14, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#1e3a5f', marginBottom: 2 }}>{s.num}</div>
            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <button onClick={() => setStep(2)} className="aff-ob-btn">Continuar</button>
    </div>,

    // Step 2: How it works
    <div key="howitworks" className="aff-ob-step">
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 64, marginBottom: 12, animation: 'aff-scale-in 0.5s ease-out' }}>💰</div>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: '#1e3a5f', margin: 0 }}>Tu programa</h2>
        <p style={{ fontSize: 14, color: '#94a3b8', margin: '8px 0 0' }}>Asi de simple funciona</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {[
          { icon: '🔗', title: 'Comparte tu link unico', desc: 'Cada persona que entre queda vinculada a ti automaticamente.' },
          { icon: '🏷️', title: 'O tu codigo de descuento', desc: 'Tu audiencia usa tu codigo al pagar — todo se rastrea a tu cuenta.' },
          { icon: '📊', title: 'Datos 100% transparentes', desc: 'Ves en tiempo real: visitantes, ventas y tu comision ganada.' },
          { icon: '💵', title: `${affiliate.commission_pct}% de comision por venta`, desc: 'Sin importar el monto de la orden. Cada venta cuenta.' },
        ].map((b, i) => (
          <div key={i} className="aff-ob-benefit" style={{ animation: `aff-fade-up 0.5s ease-out ${i * 0.1}s both` }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{b.icon}</div>
            <div>
              <strong style={{ color: '#1e3a5f', fontSize: 15 }}>{b.title}</strong>
              <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>{b.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: '#ecfdf5', borderRadius: 16, padding: '24px 28px', border: '1px solid #a7f3d0', marginBottom: 8, textAlign: 'center' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: 2, margin: '0 0 12px' }}>Potencial de ganancias</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24 }}>
          {[
            { sales: '10', earn: '$60' },
            { sales: '50', earn: '$300' },
            { sales: '100', earn: '$600' },
          ].map((e, i) => (
            <div key={i}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#059669' }}>{e.earn}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{e.sales} ventas/mes</div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={() => setStep(3)} className="aff-ob-btn">¿Como lo promuevo?</button>
    </div>,

    // Step 3: Promotion Tips
    <div key="tips" className="aff-ob-step">
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 12, animation: 'aff-scale-in 0.5s ease-out' }}>💡</div>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: '#1e3a5f', margin: '0 0 4px' }}>Como promoverlo</h2>
        <p style={{ fontSize: 14, color: '#94a3b8', margin: 0 }}>Tips que funcionan + un guion listo para usar</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {[
          { icon: '🎬', title: 'Graba la reaccion', desc: 'Filma a alguien recibiendo su cancion. Los videos de reaccion son el contenido que MAS convierte.' },
          { icon: '🔗', title: 'Link en tu bio', desc: 'Agregalo a tu bio de Instagram, TikTok o YouTube. Trafico pasivo 24/7.' },
          { icon: '📖', title: 'Cuenta una historia real', desc: '"Le regale una cancion a mi mama y lloro" — las historias personales venden mas que cualquier anuncio.' },
          { icon: '🎁', title: 'Aprovecha fechas especiales', desc: 'Dia de las Madres, San Valentin, cumpleanos... recuerdale a tu audiencia que ESTE es el regalo perfecto.' },
        ].map((tip, i) => (
          <div key={i} className="aff-ob-benefit" style={{ animation: `aff-fade-up 0.5s ease-out ${i * 0.08}s both` }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{tip.icon}</div>
            <div>
              <strong style={{ color: '#1e3a5f', fontSize: 15 }}>{tip.title}</strong>
              <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>{tip.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: '#eff6ff', borderRadius: 16, padding: '22px 24px', border: '1px solid #bfdbfe', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>🎤</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: 1 }}>Guion de ejemplo</span>
        </div>
        <p style={{ fontSize: 14, color: '#475569', margin: 0, lineHeight: 1.8, fontStyle: 'italic' }}>
          "¿Quieres darle a alguien un regalo que NUNCA va a olvidar? Imaginate regalarle una cancion con SU nombre, contando SU historia, en el genero que mas le gusta. Asi funciona RegalosQueCantan. Usa mi codigo <strong style={{ color: '#2563eb' }}>{affiliate.coupon_code || 'TU_CODIGO'}</strong> para un descuento. Link en mi bio."
        </p>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '10px 0 0', textAlign: 'center' }}>Adaptalo a tu estilo — lo importante es que sea autentico</p>
      </div>
      <button onClick={() => setStep(4)} className="aff-ob-btn">Ver mis herramientas</button>
    </div>,

    // Step 4: Tools
    <div key="tools" className="aff-ob-step" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 12, animation: 'aff-float 3s ease-in-out infinite' }}>🚀</div>
      <h2 style={{ fontSize: 28, fontWeight: 800, color: '#1e3a5f', margin: '0 0 4px' }}>Tus herramientas</h2>
      <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 28px' }}>Listas para compartir con tu audiencia</p>

      <div className="aff-ob-tool-card">
        <label style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10, display: 'block' }}>Tu link de afiliado</label>
        <div className="aff-ob-tool-row">
          <div className="aff-ob-tool-code">{affiliateLink}</div>
          <button onClick={() => copyToClipboard(affiliateLink, 'link')} className="aff-ob-copy-btn">
            {copied === 'link' ? '✓ Copiado' : 'Copiar'}
          </button>
        </div>
      </div>

      {affiliate.coupon_code && (
        <div className="aff-ob-tool-card">
          <label style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10, display: 'block' }}>Tu codigo de descuento</label>
          <div className="aff-ob-tool-row">
            <div className="aff-ob-tool-code" style={{ fontSize: 18, fontWeight: 700, letterSpacing: 4, textAlign: 'center' }}>{affiliate.coupon_code}</div>
            <button onClick={() => copyToClipboard(affiliate.coupon_code, 'coupon')} className="aff-ob-copy-btn">
              {copied === 'coupon' ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#eff6ff', borderRadius: 12, padding: '14px 20px', margin: '8px 0 4px', border: '1px solid #bfdbfe' }}>
        <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
          Ambos metodos se rastrean automaticamente. Usa el que prefieras o combinalos.
        </p>
      </div>

      <button onClick={completeOnboarding} className="aff-ob-btn" style={{ marginTop: 20 }}>
        Ir a mi dashboard →
      </button>
    </div>,
  ];

  return (
    <>
      <style>{css}</style>
      <div className="aff-ob-bg">
        <div className="aff-ob-card">
          <div style={{ display: 'flex', gap: 6, marginBottom: 36 }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i <= step ? 'linear-gradient(90deg, #2563eb, #1d4ed8)' : '#e2e8f0', transition: 'background 0.4s' }} />
            ))}
          </div>
          {steps[step]}
        </div>
      </div>
    </>
  );
}
