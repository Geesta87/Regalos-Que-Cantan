// src/pages/ReviewPage.jsx
// /calificar?song_id=... — a customer rates their purchased song 1-5 stars
// (+ optional comment/name). Feeds song_reviews via the submit-review edge
// function; approved reviews become the REAL star ratings shown in Google
// results and testimonials on the site. Noindex; house customer style
// (dark warm gradient, Montserrat, magenta CTA).
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { CenzoSignature } from '../components/Cenzo';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function Star({ filled, size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? '#E8B44A' : 'rgba(255,255,255,0.14)'}
      style={{ transition: 'fill 0.15s, transform 0.15s', transform: filled ? 'scale(1.06)' : 'scale(1)' }}>
      <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.58l-5.9 3.1 1.13-6.58L2.45 9.44l6.6-.96L12 2.5z" />
    </svg>
  );
}

export default function ReviewPage() {
  const params = new URLSearchParams(window.location.search);
  const songId = params.get('song_id') || params.get('song') || '';

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | done | already | error
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!rating || status === 'sending') return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ song_id: songId, rating, comment, name }),
      });
      const body = await res.json();
      if (body.success) setStatus('done');
      else if (body.error === 'already_reviewed') setStatus('already');
      else { setStatus('error'); setErrorMsg('No pudimos guardar tu calificación. Inténtalo de nuevo en un momento.'); }
    } catch {
      setStatus('error');
      setErrorMsg('Problema de conexión. Inténtalo de nuevo en un momento.');
    }
  };

  const card = {
    maxWidth: '520px', width: '100%',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '24px',
    padding: '36px 28px',
    border: '1px solid rgba(255,255,255,0.08)',
    backdropFilter: 'blur(20px)',
    textAlign: 'center',
  };

  return (
    <>
      <Helmet>
        <title>Califica tu canción — Regalos Que Cantan</title>
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

        {(!songId || status === 'error' && !rating) && !songId ? (
          <div style={card}>
            <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 10px' }}>Falta el enlace de tu canción</h1>
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '14px', lineHeight: 1.6 }}>
              Abre el enlace de calificación que te enviamos, o busca tu canción en{' '}
              <a href="/mi-cancion" style={{ color: '#f472b6' }}>regalosquecantan.com/mi-cancion</a>.
            </p>
          </div>
        ) : (status === 'done' || status === 'already') ? (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '18px' }}>
              {[1, 2, 3, 4, 5].map((i) => <Star key={i} filled={i <= (rating || 5)} size={30} />)}
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 10px' }}>
              {status === 'already' ? 'Ya habías calificado esta canción' : '¡Mil gracias!'}
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
              {status === 'already'
                ? 'Tu opinión ya quedó guardada. Gracias por tomarte el tiempo.'
                : 'Tu opinión nos ayuda a que más familias encuentren su canción. Si quieres otra canción para alguien especial, aquí estamos.'}
            </p>
            <a href="/" style={{
              display: 'inline-block', marginTop: '22px', padding: '14px 26px',
              background: 'linear-gradient(90deg, #C9603F, #B62463)', color: 'white',
              borderRadius: '12px', fontSize: '14px', fontWeight: 700, textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(201,96,63,0.3)',
            }}>Crear otra canción</a>
          </div>
        ) : (
          <form onSubmit={submit} style={card}>
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 8px' }}>¿Qué te pareció tu canción?</h1>
            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '14px', lineHeight: 1.6, margin: '0 0 22px' }}>
              Tu calificación es pública y ayuda a otras familias a decidirse. Solo toma unos segundos.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '6px' }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} type="button"
                  onClick={() => setRating(i)}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(0)}
                  aria-label={`${i} de 5 estrellas`}
                  style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer' }}>
                  <Star filled={i <= (hover || rating)} />
                </button>
              ))}
            </div>
            <p style={{ color: 'rgba(255,255,255,0.68)', fontSize: '12px', margin: '0 0 20px', minHeight: '16px' }}>
              {(hover || rating) === 0 ? 'Toca las estrellas' : ['', 'Muy mala', 'Mala', 'Regular', 'Buena', 'Increíble'][hover || rating]}
            </p>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Cuéntanos cómo reaccionó esa persona especial… (opcional)"
              rows={3}
              maxLength={600}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
                padding: '14px 16px', color: 'white', fontSize: '14px',
                marginBottom: '12px', outline: 'none', fontFamily: 'inherit',
                boxSizing: 'border-box', resize: 'vertical',
              }}
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre (opcional, ej. María G.)"
              maxLength={60}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
                padding: '14px 16px', color: 'white', fontSize: '14px',
                marginBottom: '16px', outline: 'none', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />

            {errorMsg && <p style={{ color: '#f87171', fontSize: '13px', margin: '0 0 12px' }}>{errorMsg}</p>}

            <button type="submit" disabled={!rating || status === 'sending'}
              style={{
                width: '100%', padding: '16px',
                background: !rating || status === 'sending' ? 'rgba(255,255,255,0.08)' : 'linear-gradient(90deg, #C9603F, #B62463)',
                color: !rating || status === 'sending' ? 'rgba(255,255,255,0.4)' : 'white',
                border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700,
                cursor: !rating || status === 'sending' ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'all 0.2s',
                boxShadow: !rating || status === 'sending' ? 'none' : '0 4px 20px rgba(201,96,63,0.3)',
              }}>
              {status === 'sending' ? 'Guardando…' : 'Enviar mi calificación'}
            </button>
          </form>
        )}
        <CenzoSignature className="justify-center my-8" />
      </div>
    </>
  );
}
