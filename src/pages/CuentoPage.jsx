// CuentoPage — public reader for a Cuento Ilustrado at /cuento/:token.
// Gift-first reveal: a sealed envelope screen opens the book AND starts the
// song (the tap doubles as the browser's autoplay-unlock gesture). Pages are
// stanzas of the customer's own song; the last page is the dedication + share.
// Customer-facing → 100% Spanish.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CenzoMark } from '../components/Cenzo';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-cuento`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

const CSS = `
  .cu-root{--crema:#FBF3E4;--papel:#FFF9EE;--tinta:#2E1F1A;--tinta2:#6B5647;--terra:#C75B39;--flor:#E8A63D;--teal:#1F5F5B;--linea:#E5D5BC;
    min-height:100vh;background:var(--crema);color:var(--tinta);display:flex;flex-direction:column;align-items:center;
    font-family:'Be Vietnam Pro','Segoe UI',system-ui,sans-serif;padding:18px 14px 90px}
  .cu-serif{font-family:'Playfair Display',Georgia,'Times New Roman',serif}
  .cu-hand{font-family:'Caveat','Segoe Script',cursive}
  .cu-brand{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--terra);margin:4px 0 14px}
  /* Envelope */
  .cu-env{max-width:430px;width:100%;min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px}
  .cu-env-card{background:var(--papel);border:1px solid var(--linea);border-radius:16px;box-shadow:0 14px 44px rgba(46,31,26,.18);
    padding:42px 30px;width:100%;cursor:pointer;transition:transform .18s ease}
  .cu-env-card:hover{transform:scale(1.02)}
  .cu-seal{width:64px;height:64px;border-radius:50%;background:var(--terra);color:var(--papel);display:flex;align-items:center;justify-content:center;
    font-size:26px;margin:0 auto 18px;box-shadow:0 6px 18px rgba(199,91,57,.4)}
  .cu-env h1{font-size:26px;line-height:1.2;margin-bottom:8px}
  .cu-env p{color:var(--tinta2);font-size:14.5px;line-height:1.5}
  .cu-tap{display:inline-block;margin-top:20px;background:var(--terra);color:var(--papel);font-weight:700;font-size:15px;
    padding:12px 26px;border-radius:999px;box-shadow:0 4px 14px rgba(199,91,57,.35)}
  /* Book */
  .cu-book{width:min(430px,100%);background:var(--papel);border:1px solid var(--linea);border-radius:14px;overflow:hidden;
    box-shadow:0 12px 40px rgba(46,31,26,.16)}
  .cu-page{display:none;animation:cuIn .45s ease}
  .cu-page.on{display:block}
  @keyframes cuIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.cu-page{animation:none}}
  .cu-page .cu-media{width:100%;aspect-ratio:3/4;overflow:hidden;background:var(--linea);position:relative}
  .cu-page img,.cu-page video{width:100%;height:100%;object-fit:cover;display:block}
  /* Ken Burns: the active page's art drifts slowly — stills feel alive. */
  .cu-page.on .cu-media img{animation:cuKB 18s ease-in-out infinite alternate}
  @keyframes cuKB{from{transform:scale(1) translate(0,0)}to{transform:scale(1.09) translate(-1.5%,-2%)}}
  @media (prefers-reduced-motion:reduce){.cu-page.on .cu-media img{animation:none}}
  .cu-text{padding:18px 22px 22px}
  .cu-folio{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--flor);font-weight:600;margin-bottom:8px}
  .cu-text p{font-size:16.5px;line-height:1.62;white-space:pre-line}
  /* Karaoke: the line being sung glows terracotta. */
  .cu-line{display:block;transition:color .3s ease,opacity .3s ease;opacity:.85}
  .cu-line.sung{color:var(--terra);opacity:1;font-weight:600}
  .cu-photo .cu-media img{animation:none}
  .cu-photo .cu-text{text-align:center}
  .cu-cover .cu-text{text-align:center;padding-top:24px}
  .cu-cover h2{font-size:30px;line-height:1.15;margin-bottom:6px}
  .cu-cover .cu-sub{color:var(--tinta2);font-size:14px}
  .cu-cinta{display:inline-block;margin-top:12px;background:var(--teal);color:var(--papel);font-size:11px;letter-spacing:.16em;
    text-transform:uppercase;padding:6px 14px;border-radius:999px}
  .cu-dedic{margin:6px 22px 18px;border:1.5px dashed var(--terra);border-radius:12px;padding:18px;text-align:center;background:rgba(199,91,57,.05)}
  .cu-dedic .cu-hand{font-size:24px;line-height:1.3;color:var(--tinta)}
  .cu-share{margin:0 22px 22px;text-align:center}
  .cu-share a{display:inline-block;background:#25D366;color:#fff;font-weight:700;font-size:15px;padding:11px 22px;border-radius:999px;text-decoration:none}
  .cu-share .cu-dom{margin-top:10px;font-size:12px;letter-spacing:.08em;color:var(--teal);font-weight:600}
  /* Controls */
  .cu-nav{width:min(430px,100%);display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:10px}
  .cu-arrow{background:var(--papel);border:1px solid var(--linea);color:var(--tinta);width:46px;height:46px;border-radius:50%;
    font-size:19px;cursor:pointer;box-shadow:0 2px 8px rgba(46,31,26,.10)}
  .cu-arrow:disabled{opacity:.35}
  .cu-dots{display:flex;gap:7px;flex-wrap:wrap;justify-content:center}
  .cu-dot{width:9px;height:9px;border-radius:50%;background:var(--linea);border:none;cursor:pointer;padding:0}
  .cu-dot.on{background:var(--terra);transform:scale(1.25)}
  /* Audio pill */
  .cu-audio{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--tinta);color:var(--crema);
    border:none;border-radius:999px;padding:10px 20px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;
    box-shadow:0 8px 24px rgba(46,31,26,.35);cursor:pointer;z-index:50}
  .cu-auto{margin-top:14px;border-radius:999px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;
    border:1.5px solid var(--linea);background:var(--papel);color:var(--tinta2)}
  .cu-auto.on{border-color:var(--teal);background:var(--teal);color:var(--papel)}
  .cu-note{font-size:11.5px;color:var(--tinta2);text-align:center;margin-top:10px;max-width:46ch;line-height:1.5}
  .cu-center{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;color:var(--tinta2)}
  @media print{
    .cu-nav,.cu-audio,.cu-share a,.cu-note{display:none!important}
    .cu-page{display:block!important;page-break-after:always;animation:none}
    .cu-book{box-shadow:none;border:none}
  }
`;

// Page art: seedance loop video when we have one (only plays while its page is
// active, so phones don't decode 3 videos at once), Ken Burns still otherwise.
function Media({ img, video, alt, active, eager = true }) {
  const vidRef = useRef(null);
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    if (active) { v.play().catch(() => {}); } else { v.pause(); }
  }, [active]);
  return (
    <div className="cu-media">
      {video
        ? <video ref={vidRef} src={video} poster={img} muted loop playsInline preload={eager ? 'auto' : 'none'} aria-label={alt} />
        : <img src={img} alt={alt} loading={eager ? 'eager' : 'lazy'} />}
    </div>
  );
}

export default function CuentoPage() {
  const token = useMemo(() => {
    const m = window.location.pathname.match(/^\/cuento\/([A-Za-z0-9]+)/);
    return m ? m[1] : '';
  }, []);
  const [state, setState] = useState('loading'); // loading | notfound | sealed | reading
  const [cuento, setCuento] = useState(null);
  const [page, setPage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [auto, setAuto] = useState(true); // pages follow the song until the reader takes over
  const [sungLine, setSungLine] = useState({ p: -1, l: -1 }); // karaoke: which line is being sung
  const audioRef = useRef(null);
  const touchX = useRef(null);
  const autoRef = useRef(true);
  const pageRef = useRef(0);
  const timesRef = useRef([]); // effective start time (s) per stanza page
  useEffect(() => { autoRef.current = auto; }, [auto]);
  useEffect(() => { pageRef.current = page; }, [page]);

  useEffect(() => {
    if (!token) { setState('notfound'); return; }
    (async () => {
      try {
        const res = await fetch(FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}` },
          body: JSON.stringify({ action: 'public', token }),
        });
        const j = await res.json().catch(() => ({}));
        if (j.success && j.cuento) { setCuento(j.cuento); setState('sealed'); }
        else setState('notfound');
      } catch { setState('notfound'); }
    })();
  }, [token]);

  const pages = useMemo(() => {
    if (!cuento) return [];
    const vids = cuento.page_videos || {};
    const list = [{ kind: 'cover', video: vids.cover }];
    (cuento.stanzas || []).forEach((s, i) => list.push({
      kind: s.text && s.text.trim() ? 'stanza' : 'quiet',
      text: s.text, lines: s.lines || [],
      img: (cuento.page_urls || [])[i], video: vids[String(i)], n: i + 1,
    }));
    if (cuento.real_photo_url) list.push({ kind: 'photo', img: cuento.real_photo_url });
    list.push({ kind: 'final' });
    return list;
  }, [cuento]);

  const open = () => {
    setState('reading');
    const a = audioRef.current;
    if (a && cuento?.audio_url) { a.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  };
  const toggleAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => {}); } else { a.pause(); setPlaying(false); }
  };
  const go = (n, manual = false) => {
    if (manual) setAuto(false); // the reader took the wheel — stop auto-turning
    setPage(Math.max(0, Math.min(pages.length - 1, n)));
  };

  // Auto-turn: pages follow the song. Sung timings (stanzas[].startS, from Kie's
  // aligned lyrics) when we have them — gaps interpolated between known
  // neighbors — otherwise even pacing across the audio duration. The final
  // (dedication) page waits for the song to end.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !cuento) return undefined;
    const stanzas = cuento.stanzas || [];
    const buildTimes = () => {
      const dur = a.duration;
      if (!Number.isFinite(dur) || dur <= 0 || !stanzas.length) return;
      const known = stanzas.map((s) => (Number.isFinite(Number(s.startS)) ? Number(s.startS) : null));
      const timedCount = known.filter((t) => t !== null).length;
      const times = [...known];
      if (timedCount >= 2) {
        // interpolate the gaps so untimed stanzas still get their moment
        for (let i = 0; i < times.length; i++) {
          if (times[i] !== null) continue;
          let lo = i - 1; while (lo >= 0 && times[lo] === null) lo--;
          let hi = i + 1; while (hi < times.length && times[hi] === null) hi++;
          const loT = lo >= 0 ? times[lo] : 0;
          const hiT = hi < times.length ? times[hi] : dur;
          const loI = lo >= 0 ? lo : -1;
          const hiI = hi < times.length ? hi : times.length;
          times[i] = loT + ((hiT - loT) * (i - loI)) / (hiI - loI);
        }
      } else {
        // no usable timings — spread pages evenly, cover keeps the intro
        for (let i = 0; i < times.length; i++) times[i] = (dur * (i + 1)) / (times.length + 2);
      }
      timesRef.current = times;
    };
    const lastIndex = stanzas.length + (cuento.real_photo_url ? 2 : 1);
    const onTime = () => {
      const t = a.currentTime;
      // Karaoke: highlight the line being sung on the VISIBLE stanza page,
      // whether or not auto-turn is driving.
      const visIdx = pageRef.current - 1; // stanza index of the visible page
      const vis = stanzas[visIdx];
      if (vis?.lines?.length) {
        let li = -1;
        for (let k = 0; k < vis.lines.length; k++) {
          const s = Number(vis.lines[k].startS);
          if (Number.isFinite(s) && t >= s) li = k;
        }
        setSungLine((prev) => (prev.p === pageRef.current && prev.l === li ? prev : { p: pageRef.current, l: li }));
      }
      if (!autoRef.current) return;
      const times = timesRef.current;
      if (!times.length) return;
      let target = 0; // cover until the first stanza is sung
      for (let i = 0; i < times.length; i++) { if (t >= times[i]) target = i + 1; }
      // never yank the reader back off the photo/dedication pages
      if (target !== pageRef.current && pageRef.current <= times.length) {
        setPage(target);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      if (autoRef.current) setPage(lastIndex); // dedication + share
    };
    a.addEventListener('loadedmetadata', buildTimes);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnded);
    if (a.readyState >= 1) buildTimes();
    return () => {
      a.removeEventListener('loadedmetadata', buildTimes);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnded);
    };
  }, [cuento, state]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') go(page - 1, true);
      if (e.key === 'ArrowRight') go(page + 1, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const waText = cuento
    ? encodeURIComponent(`Mira el cuento de nuestra canción 💛 ${window.location.origin}/cuento/${token}?src=cuento`)
    : '';

  if (state === 'loading') {
    return (<div className="cu-root"><style>{CSS}</style>
      <div className="cu-center"><div className="cu-serif" style={{ fontSize: 22 }}>Abriendo el cuento…</div></div>
    </div>);
  }
  if (state === 'notfound') {
    return (<div className="cu-root"><style>{CSS}</style>
      <div className="cu-center">
        <div className="cu-serif" style={{ fontSize: 24, color: 'var(--tinta)' }}>Cuento no encontrado</div>
        <p>El enlace no es válido o el cuento ya no está disponible.</p>
        <a href="https://regalosquecantan.com" style={{ color: 'var(--terra)', fontWeight: 700 }}>regalosquecantan.com</a>
      </div>
    </div>);
  }

  // sealed + reading share ONE tree so the <audio> element persists across the
  // reveal (a fresh element would drop playback the moment the state flips).
  return (<div className="cu-root"><style>{CSS}</style>
    <div className="cu-brand" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><CenzoMark size={34} />Regalos Que Cantan</div>
    {state === 'sealed' && (
      <div className="cu-env">
        <div className="cu-env-card" onClick={open} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(); }}>
          <div className="cu-seal">♪</div>
          <h1 className="cu-serif">Alguien preparó algo especial para ti</h1>
          <p>Un cuento ilustrado con su propia canción.{cuento?.recipient_name ? ` Para ${cuento.recipient_name}.` : ''}</p>
          <span className="cu-tap">Toca para abrir</span>
        </div>
      </div>
    )}
    {state === 'reading' && (<>
    <div className="cu-book"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 45) go(page + (dx < 0 ? 1 : -1), true);
        touchX.current = null;
      }}>
      {pages.map((pg, i) => (
        <section key={i} className={`cu-page ${pg.kind === 'cover' ? 'cu-cover' : ''} ${pg.kind === 'photo' ? 'cu-photo' : ''} ${i === page ? 'on' : ''}`}>
          {pg.kind === 'cover' && (<>
            <Media img={cuento.cover_url} video={pg.video} alt="Portada del cuento" active={i === page} />
            <div className="cu-text">
              <h2 className="cu-serif">{cuento.title || 'Nuestra Canción'}</h2>
              {(cuento.recipient_name || cuento.sender_name) && (
                <div className="cu-sub cu-serif" style={{ fontSize: 17, fontStyle: 'italic' }}>
                  {cuento.sender_name ? `De ${cuento.sender_name} ` : ''}{cuento.recipient_name ? `para ${cuento.recipient_name}` : ''}
                </div>
              )}
              <span className="cu-cinta">Un regalo con canción</span>
            </div>
          </>)}
          {pg.kind === 'stanza' && (<>
            <Media img={pg.img} video={pg.video} alt={`Ilustración de la página ${pg.n}`} active={i === page} eager={i <= page + 1} />
            <div className="cu-text">
              <div className="cu-folio">Página {pg.n} de {cuento.stanzas.length}</div>
              <p className="cu-serif">
                {pg.lines?.length
                  ? pg.lines.map((ln, li) => (
                      <span key={li} className={`cu-line ${sungLine.p === i && sungLine.l === li ? 'sung' : ''}`}>{ln.text}</span>
                    ))
                  : pg.text}
              </p>
            </div>
          </>)}
          {pg.kind === 'quiet' && (
            <Media img={pg.img} video={pg.video} alt="Ilustración" active={i === page} eager={i <= page + 1} />
          )}
          {pg.kind === 'photo' && (<>
            <Media img={pg.img} alt="Su fotografía" active={i === page} eager={i <= page + 1} />
            <div className="cu-text">
              <div className="cu-folio">La historia real</div>
              <p className="cu-serif" style={{ textAlign: 'center' }}>Y esta es la historia que inspiró la canción.</p>
            </div>
          </>)}
          {pg.kind === 'final' && (<>
            <div className="cu-text" style={{ textAlign: 'center', paddingTop: 30 }}>
              <div className="cu-folio">Fin</div>
              <h2 className="cu-serif" style={{ fontSize: 24, marginBottom: 6 }}>Cada gran amor merece su propia canción</h2>
            </div>
            {cuento.dedication && (
              <div className="cu-dedic"><div className="cu-hand">“{cuento.dedication}”</div></div>
            )}
            <div className="cu-share">
              <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>
              <div className="cu-dom">regalosquecantan.com</div>
            </div>
          </>)}
        </section>
      ))}
    </div>
    <div className="cu-nav">
      <button className="cu-arrow" onClick={() => go(page - 1, true)} disabled={page === 0} aria-label="Página anterior">‹</button>
      <div className="cu-dots">
        {pages.map((_, i) => (
          <button key={i} className={`cu-dot ${i === page ? 'on' : ''}`} onClick={() => go(i, true)} aria-label={`Ir a la página ${i + 1}`} />
        ))}
      </div>
      <button className="cu-arrow" onClick={() => go(page + 1, true)} disabled={page === pages.length - 1} aria-label="Página siguiente">›</button>
    </div>
    <button className={`cu-auto ${auto ? 'on' : ''}`} onClick={() => setAuto(!auto)}>
      {auto ? '♪ Las páginas siguen la canción' : '♪ Activar páginas automáticas'}
    </button>
    <div className="cu-note">{auto ? 'Toca una flecha o desliza para leer a tu ritmo.' : 'Desliza para pasar las páginas. La canción sigue sonando mientras lees.'}</div>
    {cuento?.audio_url && (
      <button className="cu-audio" onClick={toggleAudio}>{playing ? '❚❚  Pausar canción' : '►  Escuchar la canción'}</button>
    )}
    </>)}
    {cuento?.audio_url && <audio ref={audioRef} src={cuento.audio_url} preload="auto" onEnded={() => setPlaying(false)} />}
  </div>);
}
