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

async function callRecover(email, { action, which, group_key } = {}) {
  const body = { email };
  if (action) body.action = action;
  if (which) body.which = which;
  if (group_key) body.group_key = group_key;
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
  // Keyed by stripe_payment_id (or a fallback key) so each purchase group
  // has its own independent send state: 'idle' | 'sending' | 'sent' | 'error'
  const [paidSendStatus, setPaidSendStatus] = useState({});
  const [unpaidSendStatus, setUnpaidSendStatus] = useState('idle');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!cleaned) return;
    setStatus('searching');
    setErrorMsg('');
    setSongs([]);
    setPaidSendStatus({});
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

  // For paid groups: groupKey = stripe_payment_id (or a fallback).
  // stripePaymentId is passed to the backend to restrict the email to that purchase.
  const handleSendPaidGroup = async (groupKey) => {
    const current = paidSendStatus[groupKey] || 'idle';
    if (current === 'sending' || current === 'sent') return;
    setPaidSendStatus((prev) => ({ ...prev, [groupKey]: 'sending' }));
    try {
      const { ok, data } = await callRecover(email.trim().toLowerCase(), { action: 'send', which: 'paid', group_key: groupKey });
      const next = ok && data?.emailSent ? 'sent' : 'error';
      setPaidSendStatus((prev) => ({ ...prev, [groupKey]: next }));
    } catch {
      setPaidSendStatus((prev) => ({ ...prev, [groupKey]: 'error' }));
    }
  };

  const handleSendEmail = async (which) => {
    if (which !== 'unpaid') return;
    if (unpaidSendStatus === 'sending' || unpaidSendStatus === 'sent') return;
    setUnpaidSendStatus('sending');
    try {
      const { ok, data } = await callRecover(email.trim().toLowerCase(), { action: 'send', which });
      setUnpaidSendStatus(ok && data?.emailSent ? 'sent' : 'error');
    } catch {
      setUnpaidSendStatus('error');
    }
  };

  const handleStartOver = () => {
    setStatus('idle');
    setSongs([]);
    setEmail('');
    setErrorMsg('');
    setPaidSendStatus({});
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
                {/* ─── Paid songs section — grouped by purchase ─── */}
                {paidSongs.length > 0 && (() => {
                  // The backend already merges bundle songs into one entry per
                  // purchase (keyed by group_key = stripe_payment_id ?? stripe_session_id).
                  // We wrap each entry in its own group — one group = one purchase.
                  const groups = paidSongs.map((s, i) => ({
                    key: s.group_key || `no-key-${i}`,
                    songs: [s],
                  }));
                  return (
                    <div style={{ marginBottom: unpaidSongs.length > 0 ? '28px' : '20px' }}>
                      <p style={{
                        color: 'rgba(74,222,128,0.95)',
                        fontSize: '11px', fontWeight: 700,
                        margin: '0 0 12px',
                        textTransform: 'uppercase', letterSpacing: '1.5px',
                      }}>
                        ✅ Tus canciones compradas ({paidSongs.length})
                      </p>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {groups.map((group, gi) => {
                          const groupSendStatus = paidSendStatus[group.key] || 'idle';
                          const firstDate = group.songs[0]?.paid_at;
                          return (
                            <div
                              key={group.key}
                              style={{
                                background: 'rgba(74,222,128,0.03)',
                                border: '1px solid rgba(74,222,128,0.20)',
                                borderRadius: '16px',
                                padding: '14px',
                              }}
                            >
                              {/* Purchase header */}
                              {firstDate && (
                                <p style={{
                                  color: 'rgba(74,222,128,0.7)',
                                  fontSize: '10px', fontWeight: 700,
                                  margin: '0 0 10px',
                                  textTransform: 'uppercase', letterSpacing: '1.2px',
                                }}>
                                  🛒 Compra {gi + 1} — {formatDate(firstDate)}
                                </p>
                              )}

                              {/* Song cards */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                                {group.songs.map((s) => (
                                  <div
                                    key={s.id}
                                    style={{
                                      background: 'rgba(255,255,255,0.04)',
                                      border: '1px solid rgba(74,222,128,0.15)',
                                      borderRadius: '12px',
                                      padding: '16px',
                                      textAlign: 'center',
                                    }}
                                  >
                                    {s.has_video_addon
                                      ? <p style={{ color: '#a78bfa', fontSize: '10px', fontWeight: 800, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                                          🎬 Canción + Video{s.is_bundle ? ' (Paquete 2)' : ''}
                                        </p>
                                      : s.is_bundle && (
                                          <p style={{ color: '#ffd23f', fontSize: '10px', fontWeight: 800, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                                            🎁 Paquete 2 canciones
                                          </p>
                                        )
                                    }
                                    <p style={{ color: 'white', fontSize: '17px', fontWeight: 800, margin: '0 0 14px', wordBreak: 'break-word' }}>
                                      Para {s.recipient_name}
                                    </p>
                                    <a
                                      href={s.listen_url}
                                      style={{
                                        display: 'inline-block',
                                        background: s.has_video_addon
                                          ? 'linear-gradient(135deg, #7c3aed, #a855f7)'
                                          : 'linear-gradient(135deg, #ff6b35, #ff8c42)',
                                        color: 'white',
                                        textDecoration: 'none',
                                        fontWeight: 800,
                                        fontSize: '15px',
                                        padding: '14px 28px',
                                        borderRadius: '30px',
                                        boxShadow: s.has_video_addon
                                          ? '0 4px 18px rgba(139,92,246,0.4)'
                                          : '0 4px 18px rgba(255,107,53,0.35)',
                                      }}
                                    >
                                      {s.has_video_addon ? '🎬 Ver video y descargar' : '▶ Escuchar y descargar'}
                                    </a>
                                  </div>
                                ))}
                              </div>

                              {/* Per-purchase send button */}
                              <div style={{
                                background: 'rgba(74,222,128,0.05)',
                                border: '1px dashed rgba(74,222,128,0.25)',
                                borderRadius: '10px',
                                padding: '10px 12px',
                                textAlign: 'center',
                              }}>
                                {groupSendStatus === 'sent' ? (
                                  <p style={{ color: '#4ade80', fontSize: '13px', margin: 0, fontWeight: 600 }}>
                                    ✅ Enviamos esta compra a {email.toLowerCase().trim()}
                                  </p>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleSendPaidGroup(group.key)}
                                      disabled={groupSendStatus === 'sending'}
                                      style={{
                                        background: 'rgba(74,222,128,0.12)',
                                        border: '1px solid rgba(74,222,128,0.40)',
                                        color: 'white',
                                        padding: '9px 16px',
                                        borderRadius: '9px',
                                        fontSize: '12.5px',
                                        fontWeight: 600,
                                        cursor: groupSendStatus === 'sending' ? 'not-allowed' : 'pointer',
                                        fontFamily: 'inherit',
                                      }}
                                    >
                                      {groupSendStatus === 'sending' ? '⏳ Enviando...' : '📧 Enviar esta compra a mi correo'}
                                    </button>
                                    {groupSendStatus === 'error' && (
                                      <p style={{ color: '#f87171', fontSize: '12px', margin: '8px 0 0' }}>
                                        No pudimos enviar el correo. Intenta de nuevo.
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

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
