import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

// Reuses the same visual language as AffiliateLogin so the flow feels seamless.
const css = `
@keyframes aff-float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
.aff-login-bg {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0f2b4a 0%, #1a3d6e 30%, #1e4d8a 60%, #1a3d6e 100%);
  font-family: 'Inter', 'Nunito', -apple-system, BlinkMacSystemFont, sans-serif;
  padding: 20px; position: relative; overflow: hidden;
}
.aff-login-card {
  position: relative; background: #ffffff; border-radius: 24px; padding: 48px 40px;
  width: 100%; max-width: 420px; box-shadow: 0 24px 64px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.1);
}
.aff-login-card input {
  width: 100%; padding: 14px 18px; border-radius: 12px; border: 1.5px solid #e2e8f0;
  font-size: 15px; outline: none; color: #1e3a5f; background: #f8fafc;
  transition: border-color 0.3s, box-shadow 0.3s; box-sizing: border-box; font-family: inherit;
}
.aff-login-card input:focus { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.1); background: #ffffff; }
.aff-login-card input::placeholder { color: #94a3b8; }
.aff-login-btn {
  width: 100%; padding: 16px; border-radius: 14px; border: none;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%);
  color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; letter-spacing: 0.3px;
  transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 8px 24px rgba(37,99,235,0.3);
  font-family: inherit; margin-top: 8px;
}
.aff-login-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(37,99,235,0.4); }
.aff-login-btn:active { transform: translateY(0); }
.aff-login-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
`;

export default function AffiliateResetPassword() {
  const { navigateTo } = useContext(AppContext);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token') || '';
    setToken(t);
    if (!t) setError('Enlace inválido. Solicita un nuevo enlace de restablecimiento desde la página de inicio de sesión.');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/affiliate-reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ token, password })
      });
      const data = await response.json();
      if (!data.success) { setError(data.error || 'No se pudo restablecer la contraseña.'); return; }
      setDone(true);
    } catch { setError('Error de conexión. Intenta de nuevo.'); }
    finally { setLoading(false); }
  };

  return (
    <>
      <style>{css}</style>
      <div className="aff-login-bg">
        <div className="aff-login-card">
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 56, marginBottom: 8, animation: 'aff-float 3s ease-in-out infinite' }}>🔐</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 2px', color: '#1e3a5f' }}>Nueva contraseña</h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>Partner Portal</p>
          </div>

          {done ? (
            <div style={{ textAlign: 'center' }}>
              <p style={{ color: '#059669', fontSize: 15, fontWeight: 600, padding: '14px 16px', background: '#ecfdf5', borderRadius: 12, border: '1px solid #a7f3d0', margin: '0 0 24px' }}>
                ✓ Tu contraseña ha sido actualizada. Ya puedes iniciar sesión.
              </p>
              <button onClick={() => navigateTo('affiliateLogin')} className="aff-login-btn">Ir a Iniciar Sesión</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, letterSpacing: 0.5 }}>NUEVA CONTRASEÑA</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required disabled={!token} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6, letterSpacing: 0.5 }}>CONFIRMAR CONTRASEÑA</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required disabled={!token} />
              </div>
              {error && <p style={{ color: '#dc2626', fontSize: 13, margin: 0, padding: '10px 14px', background: '#fef2f2', borderRadius: 10, border: '1px solid #fecaca' }}>{error}</p>}
              <button type="submit" disabled={loading || !token} className="aff-login-btn">
                {loading ? 'Guardando...' : 'Restablecer contraseña'}
              </button>
            </form>
          )}

          <p style={{ textAlign: 'center', fontSize: 13, color: '#94a3b8', marginTop: 28 }}>
            <a href="/afiliado" onClick={e => { e.preventDefault(); navigateTo('affiliateLogin'); }} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>← Volver a Iniciar Sesión</a>
          </p>
        </div>
      </div>
    </>
  );
}
