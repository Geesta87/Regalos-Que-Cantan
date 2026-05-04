import React, { useContext, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AppContext } from '../App';

export default function RecoverSongPage() {
  const { navigateTo } = useContext(AppContext);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!cleaned) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/recover-song`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email: cleaned }),
      });
      if (res.ok) {
        setStatus('sent');
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data?.error === 'invalid email'
          ? 'Por favor ingresa un correo válido.'
          : 'Hubo un problema. Intenta de nuevo en un momento.');
        setStatus('error');
      }
    } catch (err) {
      setErrorMsg('Hubo un problema de conexión. Intenta de nuevo.');
      setStatus('error');
    }
  };

  const submitting = status === 'submitting';
  const sent = status === 'sent';

  return (
    <>
      <Helmet>
        <title>Recuperar mi canción — Regalos Que Cantan</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #2a1408 0%, #1a0e08 100%)',
        color: 'white',
        fontFamily: "'Montserrat', sans-serif",
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet" />

        <div style={{
          maxWidth: '480px', width: '100%',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: '24px',
          padding: '40px 28px',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '40px', marginBottom: '14px' }}>🎵</div>
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 10px' }}>
              Recuperar mi canción
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
              Ingresa el correo que usaste al comprar y te reenviaremos el enlace de tu canción.
            </p>
          </div>

          {sent ? (
            <div style={{
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.25)',
              borderRadius: '14px',
              padding: '24px 20px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>✉️</div>
              <p style={{ color: 'white', fontWeight: 700, fontSize: '15px', margin: '0 0 10px', lineHeight: 1.4 }}>
                Listo. Si encontramos canciones asociadas a tu correo, recibirás un email en los próximos minutos.
              </p>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
                Revisa tu bandeja de entrada — y la carpeta de spam por si acaso.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label
                htmlFor="recover-email-input"
                style={{
                  display: 'block', color: 'rgba(255,255,255,0.6)',
                  fontSize: '11px', fontWeight: 600,
                  marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px',
                }}
              >
                Tu correo
              </label>
              <input
                id="recover-email-input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                disabled={submitting}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  color: 'white',
                  fontSize: '15px',
                  marginBottom: '14px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />

              {errorMsg && (
                <p style={{ color: '#f87171', fontSize: '13px', margin: '0 0 12px' }}>
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || !email.trim()}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: submitting || !email.trim()
                    ? 'rgba(255,255,255,0.08)'
                    : 'linear-gradient(90deg, #e11d74, #c026d3)',
                  color: submitting || !email.trim() ? 'rgba(255,255,255,0.4)' : 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: submitting || !email.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.2s',
                  boxShadow: submitting || !email.trim() ? 'none' : '0 4px 20px rgba(225,29,116,0.3)',
                }}
              >
                {submitting ? '⏳ Enviando...' : '📧 Reenviar enlace de mi canción'}
              </button>
            </form>
          )}
        </div>

        <p style={{
          maxWidth: '480px', width: '100%',
          color: 'rgba(255,255,255,0.4)',
          fontSize: '12px',
          lineHeight: 1.6,
          marginTop: '20px',
          textAlign: 'center',
        }}>
          ¿Necesitas ayuda? Escríbenos a{' '}
          <a href="mailto:hola@regalosquecantan.com" style={{ color: '#ff6b35', fontWeight: 600, textDecoration: 'none' }}>
            hola@regalosquecantan.com
          </a>
        </p>

        <a
          href="/"
          onClick={(e) => { e.preventDefault(); navigateTo('landing'); }}
          style={{
            color: 'rgba(255,255,255,0.5)',
            textDecoration: 'none',
            fontSize: '13px',
            marginTop: '14px',
            fontWeight: 600,
          }}
        >
          ← Volver al inicio
        </a>
      </div>
    </>
  );
}
