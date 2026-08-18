import React, { useContext, useEffect } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';
import { CenzoGuide } from '../components/Cenzo';

// /pack-listo — shown after a successful song-pack purchase (3/5/10 canciones;
// create-checkout appends ?songs=N to the success URL). The personal code is
// minted + emailed by stripe-webhook on payment, so this page confirms the
// purchase and points the buyer at their inbox + the funnel.
export default function PackReadyPage() {
  const { navigateTo } = useContext(AppContext);
  const songs = (() => {
    const n = parseInt(new URLSearchParams(window.location.search).get('songs'), 10);
    return [2, 3, 5, 10].includes(n) ? n : 3;
  })();

  useEffect(() => { trackStep(`pack${songs}_success`); }, [songs]);

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center night-sky text-white antialiased px-6 py-16">
      <div className="w-full max-w-md text-center">
        <CenzoGuide size={176} className="mx-auto mb-2" />
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-turquesa/15 border border-turquesa/30">
          <span className="material-symbols-outlined text-turquesa text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">¡Gracias por tu compra! 🎵</h1>
        <p className="mt-3 text-ink-2 text-base leading-relaxed">
          Tu <strong className="text-white">Paquete de {songs} Canciones</strong> está listo. Te enviamos tu
          <strong className="text-landing-primary"> código personal por correo</strong> — sirve para crear
          {' '}{songs} canciones personalizadas, una para cada persona, cuando tú quieras.
        </p>

        <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left">
          <p className="text-xs font-bold uppercase tracking-widest text-landing-primary mb-3">Cómo usarlo</p>
          <ol className="space-y-2.5 text-sm text-ink-2 leading-snug list-decimal list-inside">
            <li>Revisa tu correo (y la carpeta de spam) — ahí está tu código.</li>
            <li>Crea tu canción: elige el género, el nombre y la historia.</li>
            <li>Al pagar, escribe tu código y esa canción te sale <strong className="text-white">gratis</strong>.</li>
            <li>Repite hasta {songs} veces — una canción distinta por persona. Tienes 12 meses.</li>
          </ol>
        </div>

        <button
          onClick={() => navigateTo('genre')}
          className="mt-7 w-full bg-landing-primary hover:bg-landing-primary/90 text-white text-lg font-bold px-8 py-4 rounded-xl transition-all shadow-xl shadow-landing-primary/20 inline-flex items-center justify-center gap-2 group"
        >
          🎵 Crear mi primera canción
          <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
        </button>

        <p className="mt-5 text-ink-3 text-xs">
          ¿No te llegó el correo en unos minutos? Escríbenos a{' '}
          <a className="text-landing-primary" href="mailto:hola@regalosquecantan.com">hola@regalosquecantan.com</a>
        </p>
      </div>
    </div>
  );
}
