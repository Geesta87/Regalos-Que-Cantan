import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

const css = `
@keyframes aff-float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}
.aff-login-bg {
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
.aff-login-bg::before {
  content: '';
  position: absolute;
  top: -40%;
  right: -20%;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(74,158,255,0.12) 0%, transparent 70%);
}
.aff-login-bg::after {
  content: '';
  position: absolute;
  bottom: -30%;
  left: -15%;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(56,189,248,0.08) 0%, transparent 70%);
}
.aff-login-card {
  position: relative;
  background: #ffffff;
  border-radius: 24px;
  padding: 48px 40px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.1);
}
.aff-login-card input {
  width: 100%;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1.5px solid #e2e8f0;
  font-size: 15px;
  outline: none;
  color: #1e3a5f;
  background: #f8fafc;
  transition: border-color 0.3s, box-shadow 0.3s;
  box-sizing: border-box;
  font-family: inherit;
}
.aff-login-card input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 4px rgba(59,130,246,0.1);
  background: #ffffff;
}
.aff-login-card input::placeholder { color: #94a3b8; }
.aff-login-btn {
  width: 100%;
  padding: 16px;
  border-radius: 14px;
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
  margin-top: 8px;
}
.aff-login-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(37,99,235,0.4); }
.aff-login-btn:active { transform: translateY(0); }
.aff-login-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
`;

export default function AffiliateLogin() {
  const { navigateTo } = useContext(AppContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const auth = localStorage.getItem('rqc_affiliate_auth');
    if (auth) {
      try {
        const data = JSON.parse(auth);
        if (data.token && data.affiliate) {
          navigateTo(data.affiliate.onboarded ? 'affiliateDashboard' : 'affiliateOnboarding');
        }
      } catch { /* ignore */ }
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/affiliate-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const data = await response.json();
      if (!data.success) { setError(data.error || 'Error al iniciar sesion'); return; }
      localStorage.setItem('rqc_affiliate_auth', JSON.stringify({ token: data.token, affiliate: data.affiliate, timestamp: Date.now() }));
      navigateTo(data.affiliate.onboarded ? 'affiliateDashboard' : 'affiliateOnboarding');
    } catch { setError('Error de conexion. Intenta de nuevo.'); }
    finally { setLoading(false); }
  };

  return (
    <>
      <style>{css}</style>
      <div className="aff-login-bg">
        <div className="aff-login-card">
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 56, marginBottom: 8, animation: 'aff-float 3s ease-in-out infinite' }}>🎵</div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 2px', color: '#1e3a5f' }}>RegalosQueCantan</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>Partner Portal</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, letterSpacing: 0.5 }}>CORREO ELECTRONICO</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, letterSpacing: 0.5 }}>CONTRASENA</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            {error && <p style={{ color: '#dc2626', fontSize: 13, margin: 0, padding: '10px 14px', background: '#fef2f2', borderRadius: 10, border: '1px solid #fecaca' }}>{error}</p>}
            <button type="submit" disabled={loading} className="aff-login-btn">
              {loading ? 'Ingresando...' : 'Iniciar Sesion'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#94a3b8', marginTop: 28 }}>
            ¿No tienes cuenta? <a href="mailto:hola@regalosquecantan.com" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Contactanos</a>
          </p>
          <p style={{ textAlign: 'center', fontSize: 12, color: '#cbd5e1', marginTop: 12 }}>
            <a href="/afiliado/terminos" onClick={e => { e.preventDefault(); navigateTo('affiliateTerms'); }} style={{ color: '#94a3b8', textDecoration: 'none' }}>Terminos y condiciones</a>
          </p>
        </div>
      </div>
    </>
  );
}
