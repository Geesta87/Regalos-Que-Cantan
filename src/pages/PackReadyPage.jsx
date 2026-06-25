import React, { useContext, useEffect } from 'react';
import { AppContext } from '../App';
import { trackStep } from '../services/tracking';

// /pack-listo — shown after a successful "Paquete de 3 canciones" purchase.
// The personal code is minted + emailed by stripe-webhook on payment, so this
// page confirms the purchase and points the buyer at their inbox + the funnel.
export default function PackReadyPage() {
  const { navigateTo } = useContext(AppContext);

  useEffect(() => { trackStep('pack3_success'); }, []);

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-landing-bg text-white antialiased px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 border border-green-500/30">
          <span className="material-symbols-outlined text-green-400 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">¡Gracias por tu compra! 🎵</h1>
        <p className="mt-3 text-slate-300 text-base leading-relaxed">
          Tu <strong className="text-white">Paquete de 3 Canciones</strong> está listo. Te enviamos tu
          <strong className="text-landing-primary"> código personal por correo</strong> — sirve para crear
          3 canciones personalizadas, una para cada persona, cuando tú quieras.
        </p>

        <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left">
          <p className="text-xs font-bold uppercase tracking-widest text-landing-primary mb-3">Cómo usarlo</p>
          <ol className="space-y-2.5 text-sm text-slate-300 leading-snug list-decimal list-inside">
            <li>Revisa tu correo (y la carpeta de spam) — ahí está tu código.</li>
            <li>Crea tu canción: elige el género, el nombre y la historia.</li>
            <li>Al pagar, escribe tu código y esa canción te sale <strong className="text-white">gratis</strong>.</li>
            <li>Repite hasta 3 veces — una canción distinta por persona. Tienes 12 meses.</li>
          </ol>
        </div>

        <button
          onClick={() => navigateTo('genre')}
          className="mt-7 w-full bg-landing-primary hover:bg-landing-primary/90 text-white text-lg font-bold px-8 py-4 rounded-xl transition-all shadow-xl shadow-landing-primary/20 inline-flex items-center justify-center gap-2 group"
        >
          🎵 Crear mi primera canción
          <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
        </button>

        <p className="mt-5 text-slate-500 text-xs">
          ¿No te llegó el correo en unos minutos? Escríbenos a{' '}
          <a className="text-landing-primary" href="mailto:hola@regalosquecantan.com">hola@regalosquecantan.com</a>
        </p>
      </div>
    </div>
  );
}
