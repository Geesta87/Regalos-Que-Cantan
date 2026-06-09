import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Helmet } from 'react-helmet-async';

// Public landing page for a song's KARAOKE (instrumental, no-voice) version.
// Reached at /karaoke/<songId> — this is the link the owner shares with the
// customer. The raw audio file lives at /karaoke/<songId>.mp3 (a vercel.json
// rewrite proxies that to Supabase Storage); this page wraps it in a branded
// frame that explains it's the sing-along instrumental and offers a download.
//
// Routing note: App.jsx maps any /karaoke/<id> WITHOUT a file extension to this
// page. The vercel.json rewrite only matches /karaoke/<file>.<ext>, so the .mp3
// keeps serving the audio while the bare path serves the app.

const supabase = import.meta.env.VITE_SUPABASE_URL
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

const PINK = '#f20d80';

export default function KaraokePage() {
  const songId = (window.location.pathname.match(/\/karaoke\/([^/?#]+)/) || [])[1] || '';
  const [state, setState] = useState({ loading: true, song: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!songId || !supabase) {
        setState({ loading: false, song: null, error: 'not_found' });
        return;
      }
      try {
        const { data, error } = await supabase
          .from('songs')
          .select('id, recipient_name, karaoke_url, karaoke_status')
          .eq('id', songId)
          .single();
        if (cancelled) return;
        if (error || !data) {
          setState({ loading: false, song: null, error: 'not_found' });
          return;
        }
        setState({ loading: false, song: data, error: null });
      } catch {
        if (!cancelled) setState({ loading: false, song: null, error: 'not_found' });
      }
    })();
    return () => { cancelled = true; };
  }, [songId]);

  const { loading, song } = state;
  // Authoritative source is the stored karaoke_url; fall back to the proxy path.
  const audioSrc = song?.karaoke_url || (songId ? `/karaoke/${songId}.mp3` : '');
  // Same-origin relative href makes the browser honor the download filename.
  const downloadHref = audioSrc.replace(/^https?:\/\/(www\.)?regalosquecantan\.com/i, '');
  const recipient = (song?.recipient_name || '').trim();
  const ready = !!song && song.karaoke_status === 'ready' && !!audioSrc;
  const downloadName = `karaoke-${(recipient || 'regalosquecantan').replace(/\s+/g, '-').toLowerCase()}.mp3`;

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-4 py-10"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -10%, rgba(242,13,128,0.18), transparent 60%), linear-gradient(180deg, #1c1216 0%, #181114 55%, #120c0f 100%)',
        fontFamily: '"Be Vietnam Pro", sans-serif',
      }}
    >
      <Helmet>
        <title>{recipient ? `Karaoke para ${recipient} · Regalos Que Cantan` : 'Versión Karaoke · Regalos Que Cantan'}</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <a href="https://www.regalosquecantan.com" style={{ marginBottom: 22 }}>
        <img src="/images/logo.png" alt="Regalos Que Cantan" style={{ height: 44, width: 'auto', opacity: 0.95 }} />
      </a>

      <div
        className="w-full"
        style={{
          maxWidth: 540,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(242,13,128,0.28)',
          borderRadius: 24,
          padding: '32px 26px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.02) inset',
          backdropFilter: 'blur(14px)',
          textAlign: 'center',
        }}
      >
        {/* Instrumental badge */}
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(242,13,128,0.14)',
            border: '1px solid rgba(242,13,128,0.45)',
            color: '#ffd9ec', fontWeight: 700, fontSize: 12, letterSpacing: 0.5,
            padding: '6px 14px', borderRadius: 999, marginBottom: 18, textTransform: 'uppercase',
          }}
        >
          🎤 Instrumental · sin voz
        </div>

        <h1
          style={{
            fontFamily: '"Playfair Display", serif',
            color: '#fff', fontSize: 28, lineHeight: 1.2, margin: '0 0 10px', fontWeight: 800,
          }}
        >
          {recipient ? `Versión Karaoke para ${recipient}` : 'Versión Karaoke'}
        </h1>

        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 1.55, margin: '0 0 24px' }}>
          Esta es la canción <strong style={{ color: '#fff' }}>sin la voz</strong> — solo la música,
          para que la cantes tú en fiestas, en familia o donde quieras. 🎶
        </p>

        {loading && (
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, padding: '24px 0' }}>Cargando tu karaoke…</p>
        )}

        {!loading && ready && (
          <>
            <audio
              controls
              src={audioSrc}
              style={{ width: '100%', marginBottom: 22, borderRadius: 12 }}
            />

            <a
              href={downloadHref}
              download={downloadName}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                width: '100%', padding: '15px 18px',
                background: `linear-gradient(135deg, ${PINK}, #ff5aa9)`,
                color: '#fff', fontWeight: 800, fontSize: 16,
                borderRadius: 16, textDecoration: 'none',
                boxShadow: '0 10px 28px rgba(242,13,128,0.4)',
              }}
            >
              ⬇️ Descargar Karaoke (MP3)
            </a>
          </>
        )}

        {!loading && !ready && (
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 1.5, padding: '12px 0' }}>
            🎤 Tu versión karaoke aún se está preparando o no está disponible.
            <br />
            Escríbenos a{' '}
            <a href="mailto:hola@regalosquecantan.com" style={{ color: '#ffb3d8', fontWeight: 700 }}>
              hola@regalosquecantan.com
            </a>{' '}
            y te ayudamos.
          </p>
        )}
      </div>

      <a
        href="https://www.regalosquecantan.com"
        style={{ marginTop: 26, color: 'rgba(255,255,255,0.55)', fontSize: 13, textDecoration: 'none' }}
      >
        Hecho con <span style={{ color: PINK }}>❤</span> por Regalos Que Cantan →
      </a>
    </div>
  );
}
