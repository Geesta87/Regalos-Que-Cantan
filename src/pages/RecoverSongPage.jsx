import React, { useContext, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AppContext } from '../App';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return ''; }
}

async function callRecover(email, { action, which } = {}) {
  const body = { email };
  if (action) body.action = action;
  if (which) body.which = which;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/recover-song`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default function RecoverSongPage() {
  const { navigateTo } = useContext(AppContext);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | searching | found | none | error
  const [songs, setSongs] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  // Independent send-state per section.
  // Each is one of: 'idle' | 'sending' | 'sent' | 'error'
  const [paidSendStatus, setPaidSendStatus] = useState('idle');
  const [unpaidSendStatus, setUnpaidSendStatus] = useState('idle');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!cleaned) return;
    setStatus('searching');
    setErrorMsg('');
    setSongs([]);
    setPaidSendStatus('idle');
    setUnpaidSendStatus('idle');
    try {
      const { ok, status: httpStatus, data } = await callRecover(cleaned, { action: 'lookup' });
      if (httpStatus === 429) {
        setErrorMsg('Demasiados intentos. Por favor espera unos minutos antes de volver a intentar.');
        setStatus('error');
        return;
      }
      if (!ok) {
        setErrorMsg(data?.error === 'invalid email'
          ? 'Por favor ingresa un correo válido.'
          : 'Hubo un problema. Intenta de nuevo en un momento.');
        setStatus('error');
        return;
      }
      if (Array.isArray(data?.songs) && data.songs.length > 0) {
        setSongs(data.songs);
        setStatus('found');
      } else {
        setStatus('none');
      }
    } catch (err) {
      setErrorMsg('Hubo un problema de conexión. Intenta de nuevo.');
      setStatus('error');
    }
  };

  const handleSendEmail = async (which) => {
    const setter = which === 'paid' ? setPaidSendStatus : setUnpaidSendStatus;
    const current = which === 'paid' ? paidSendStatus : unpaidSendStatus;
    if (current === 'sending' || current === 'sent') return;
    setter('sending');
    try {
      const { ok, data } = await callRecover(email.trim().toLowerCase(), { action: 'send', which });
      if (ok && data?.emailSent) {
        setter('sent');
      } else {
        setter('error');
      }
    } catch {
      setter('error');
    }
  };

  const handleStartOver = () => {
    setStatus('idle');
    setSongs([]);
    setEmail('');
    setErrorMsg('');
    setPaidSendStatus('idle');
    setUnpaidSendStatus('idle');
  };

  const searching = status === 'searching';

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
          maxWidth: '520px', width: '100%',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: '24px',
          padding: '36px 28px',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '40px', marginBottom: '14px' }}>🎵</div>
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 10px' }}>
              {status === 'found' ? 'Encontramos tus canciones' : 'Encontrar mi canción'}
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
              {status === 'found'
                ? `${songs.length === 1 ? '1 canción asociada' : `${songs.length} canciones asociadas`} a ${email.toLowerCase().trim()}`
                : 'Ingresa el correo que usaste al crear tu canción y te mostraremos lo que encontramos — tanto las compradas como las pendientes.'}
            </p>
          </div>

          {/* ─── Idle / Error / Searching: Form ─── */}
          {(status === 'idle' || status === 'error' || status === 'searching') && (
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
                disabled={searching}
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
                disabled={searching || !email.trim()}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: searching || !email.trim()
                    ? 'rgba(255,255,255,0.08)'
                    : 'linear-gradient(90deg, #e11d74, #c026d3)',
                  color: searching || !email.trim() ? 'rgba(255,255,255,0.4)' : 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: searching || !email.trim() ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.2s',
                  boxShadow: searching || !email.trim() ? 'none' : '0 4px 20px rgba(225,29,116,0.3)',
                }}
              >
                {searching ? '⏳ Buscando...' : '🔍 Buscar mis canciones'}
              </button>
            </form>
          )}

          {/* ─── No songs found ─── */}
          {status === 'none' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: '14px',
                padding: '24px 18px',
                marginBottom: '16px',
              }}>
                <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔎</div>
                <p style={{ color: 'white', fontWeight: 700, fontSize: '15px', margin: '0 0 10px', lineHeight: 1.4 }}>
                  No encontramos canciones con este correo
                </p>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
                  Verifica que sea el correo exacto que usaste al comprar — incluyendo mayúsculas/minúsculas. Si crees que hay un error, escríbenos a{' '}
                  <a href="mailto:hola@regalosquecantan.com" style={{ color: '#ff6b35', fontWeight: 600 }}>
                    hola@regalosquecantan.com
                  </a>
                </p>
              </div>
              <button
                onClick={handleStartOver}
                style={{
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '10px',
                  padding: '10px 18px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Probar con otro correo
              </button>
            </div>
          )}

          {/* ─── Songs found: two sections (paid + unpaid) ─── */}
          {status === 'found' && (() => {
            const paidSongs = songs.filter((s) => s.paid);
            const unpaidSongs = songs.filter((s) => !s.paid);
            return (
              <>
                {/* ─── Paid songs section ─── */}
                {paidSongs.length > 0 && (
                  <div style={{ marginBottom: unpaidSongs.length > 0 ? '28px' : '20px' }}>
                    <p style={{
                      color: 'rgba(74,222,128,0.95)',
                      fontSize: '11px', fontWeight: 700,
                      margin: '0 0 10px',
                      textTransform: 'uppercase', letterSpacing: '1.5px',
                    }}>
                      ✅ Tus canciones compradas ({paidSongs.length})
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {paidSongs.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(74,222,128,0.25)',
                            borderRadius: '14px',
                            padding: '16px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                              <p style={{ color: 'rgba(255,210,63,0.95)', fontSize: '11px', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
                                Canción para
                              </p>
                              <p style={{ color: 'white', fontSize: '17px', fontWeight: 800, margin: '0 0 2px', wordBreak: 'break-word' }}>
                                {s.recipient_name}
                              </p>
                              {s.paid_at && (
                                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', margin: 0 }}>
                                  Comprada el {formatDate(s.paid_at)}
                                </p>
                              )}
                            </div>
                            <a
                              href={s.listen_url}
                              style={{
                                background: 'linear-gradient(90deg, #ff6b35, #ff8c42)',
                                color: 'white',
                                textDecoration: 'none',
                                fontWeight: 700,
                                fontSize: '13px',
                                padding: '11px 16px',
                                borderRadius: '10px',
                                whiteSpace: 'nowrap',
                                boxShadow: '0 4px 14px rgba(255,107,53,0.3)',
                              }}
                            >
                              ▶ Escuchar y descargar
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Email send for PAID section */}
                    <div style={{
                      marginTop: '12px',
                      background: 'rgba(74,222,128,0.05)',
                      border: '1px dashed rgba(74,222,128,0.30)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      textAlign: 'center',
                    }}>
                      {paidSendStatus === 'sent' ? (
                        <p style={{ color: '#4ade80', fontSize: '13px', margin: 0, fontWeight: 600 }}>
                          ✅ Enviamos {paidSongs.length === 1 ? 'tu canción comprada' : `tus ${paidSongs.length} canciones compradas`} a {email.toLowerCase().trim()}
                        </p>
                      ) : (
                        <>
                          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12.5px', margin: '0 0 10px', lineHeight: 1.5 }}>
                            ¿Prefieres recibir el enlace de {paidSongs.length === 1 ? 'esta canción comprada' : `estas ${paidSongs.length} canciones compradas`} en tu correo?
                          </p>
                          <button
                            onClick={() => handleSendEmail('paid')}
                            disabled={paidSendStatus === 'sending'}
                            style={{
                              background: 'rgba(74,222,128,0.12)',
                              border: '1px solid rgba(74,222,128,0.40)',
                              color: 'white',
                              padding: '10px 18px',
                              borderRadius: '10px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: paidSendStatus === 'sending' ? 'not-allowed' : 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            {paidSendStatus === 'sending'
                              ? '⏳ Enviando...'
                              : `📧 Enviar ${paidSongs.length === 1 ? 'mi canción comprada' : 'mis canciones compradas'}`}
                          </button>
                          {paidSendStatus === 'error' && (
                            <p style={{ color: '#f87171', fontSize: '12px', margin: '8px 0 0' }}>
                              No pudimos enviar el correo. Intenta de nuevo.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* ─── Unpaid songs section ─── */}
                {unpaidSongs.length > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <p style={{
                      color: 'rgba(255,210,63,0.95)',
                      fontSize: '11px', fontWeight: 700,
                      margin: '0 0 6px',
                      textTransform: 'uppercase', letterSpacing: '1.5px',
                    }}>
                      ⏳ Pendientes de compra ({unpaidSongs.length})
                    </p>
                    <p style={{
                      color: 'rgba(255,255,255,0.55)',
                      fontSize: '12px',
                      margin: '0 0 10px',
                      lineHeight: 1.5,
                    }}>
                      Estas canciones ya están listas pero aún no se han comprado. Escucha la vista previa y completa la compra para descargar la versión completa.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {unpaidSongs.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,210,63,0.25)',
                            borderRadius: '14px',
                            padding: '16px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                              <p style={{ color: 'rgba(255,210,63,0.95)', fontSize: '11px', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '1.2px' }}>
                                Canción para
                              </p>
                              <p style={{ color: 'white', fontSize: '17px', fontWeight: 800, margin: '0 0 2px', wordBreak: 'break-word' }}>
                                {s.recipient_name}
                              </p>
                              {s.created_at && (
                                <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', margin: 0 }}>
                                  Creada el {formatDate(s.created_at)}
                                </p>
                              )}
                            </div>
                            <a
                              href={s.listen_url}
                              style={{
                                background: 'linear-gradient(90deg, #e11d74, #c026d3)',
                                color: 'white',
                                textDecoration: 'none',
                                fontWeight: 700,
                                fontSize: '13px',
                                padding: '11px 16px',
                                borderRadius: '10px',
                                whiteSpace: 'nowrap',
                                boxShadow: '0 4px 14px rgba(225,29,116,0.3)',
                              }}
                            >
                              💳 Comprar
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Email send for UNPAID section */}
                    <div style={{
                      marginTop: '12px',
                      background: 'rgba(255,210,63,0.05)',
                      border: '1px dashed rgba(255,210,63,0.30)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      textAlign: 'center',
                    }}>
                      {unpaidSendStatus === 'sent' ? (
                        <p style={{ color: '#4ade80', fontSize: '13px', margin: 0, fontWeight: 600 }}>
                          ✅ Te enviamos un recordatorio de {unpaidSongs.length === 1 ? 'tu canción pendiente' : `tus ${unpaidSongs.length} canciones pendientes`} a {email.toLowerCase().trim()}
                        </p>
                      ) : (
                        <>
                          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12.5px', margin: '0 0 10px', lineHeight: 1.5 }}>
                            ¿Quieres un recordatorio por correo de {unpaidSongs.length === 1 ? 'esta canción pendiente' : `estas ${unpaidSongs.length} canciones pendientes`}?
                          </p>
                          <button
                            onClick={() => handleSendEmail('unpaid')}
                            disabled={unpaidSendStatus === 'sending'}
                            style={{
                              background: 'rgba(255,210,63,0.12)',
                              border: '1px solid rgba(255,210,63,0.40)',
                              color: 'white',
                              padding: '10px 18px',
                              borderRadius: '10px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: unpaidSendStatus === 'sending' ? 'not-allowed' : 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            {unpaidSendStatus === 'sending'
                              ? '⏳ Enviando...'
                              : `📧 Enviarme recordatorio ${unpaidSongs.length === 1 ? 'de mi canción pendiente' : 'de mis pendientes'}`}
                          </button>
                          {unpaidSendStatus === 'error' && (
                            <p style={{ color: '#f87171', fontSize: '12px', margin: '8px 0 0' }}>
                              No pudimos enviar el correo. Intenta de nuevo.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleStartOver}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '10px',
                    padding: '10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Buscar con otro correo
                </button>
              </>
            );
          })()}
        </div>

        <p style={{
          maxWidth: '520px', width: '100%',
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
