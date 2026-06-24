import React, { useState, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// OneTapUpsell — post-purchase secondary upsell on the buyer's /success page.
// Laid out as a 2-column PRODUCT GRID (e-commerce style): 4 boxes, 2 per row.
// Each box = a real PREVIEW of the deliverable + a single-tap buy that charges
// the card saved at the song purchase (no second checkout).
//   item: { key, price, title, sub, media }  media: {type:'video',src}|{type:'ab'}|{type:'lyrics'}
//   onCharge(itemKey, payload?) -> Promise<{ status:'paid'|'needs_action'|'error' }>
// Default export = self-contained DEMO (route /upsell-demo).
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = '#f5b942';
const PINK = '#f6589f';
const GREEN = '#5fcf8a';
const BLUE = '#3b82f6';
const MEDIA_H = 132;

const CSS = `
@keyframes otuSpin{to{transform:rotate(360deg)}}
@keyframes otuIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes otuWave{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
@keyframes otuLyric{0%{opacity:0;transform:translateY(6px)}4%{opacity:1;transform:translateY(0)}21%{opacity:1;transform:translateY(0)}25%{opacity:0;transform:translateY(-6px)}100%{opacity:0;transform:translateY(-6px)}}
`;

function Spinner({ color = GOLD }) {
  return <span style={{ width: 15, height: 15, borderRadius: '50%', display: 'inline-block', border: `2px solid ${color}40`, borderTopColor: color, animation: 'otuSpin 0.7s linear infinite' }} />;
}

// ── Video preview (Animado sample, SMS reaction) — fills the box thumbnail. ──
function VideoMedia({ src, tall }) {
  const ref = useRef(null);
  const [muted, setMuted] = useState(true);
  const toggle = (e) => { if (e) e.stopPropagation(); const v = ref.current; if (!v) return; const n = !muted; v.muted = n; setMuted(n); if (!n) v.play().catch(() => {}); };
  const badge = (
    <span style={{ position: 'absolute', top: 6, left: 6, display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(0,0,0,0.55)', padding: '2px 7px', borderRadius: 20, fontSize: 9, color: '#fff', fontWeight: 700 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: GREEN }} />Muestra real
    </span>
  );
  const sndBtn = (
    <button onClick={toggle} style={{ position: 'absolute', bottom: 6, right: 6, border: 'none', cursor: 'pointer', background: muted ? 'rgba(247,77,166,0.92)' : 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 20 }}>
      {muted ? '🔇 oír' : '🔊'}
    </button>
  );
  // Detail view: show the full vertical video so nothing important is cropped.
  if (tall) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', background: '#0d0a12', padding: '14px 0' }}>
        <div style={{ position: 'relative', width: 220, maxWidth: '66%', borderRadius: 13, overflow: 'hidden', border: '2px solid rgba(245,185,66,0.4)' }}>
          <video ref={ref} src={src} muted loop playsInline autoPlay onClick={toggle} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block', cursor: 'pointer' }} />
          {badge}{sndBtn}
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', height: MEDIA_H, background: '#0d0a12' }}>
      <video ref={ref} src={src} muted loop playsInline autoPlay onClick={toggle} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }} />
      {badge}{sndBtn}
    </div>
  );
}

// ── Instrumental con-voz / sin-voz — tap the thumbnail to drop the voice. ──
function AbMedia() {
  const [sin, setSin] = useState(true);
  const bars = [12, 18, 24, 15, 27, 33, 21, 13, 29, 22, 31, 16, 24, 28, 12, 20];
  return (
    <div onClick={(e) => { e.stopPropagation(); setSin((v) => !v); }} style={{ position: 'relative', height: MEDIA_H, background: 'linear-gradient(135deg,#241d2e,#15101c)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', padding: '0 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 38, width: '100%', justifyContent: 'center' }}>
        {bars.map((h, i) => {
          const voice = i % 3 === 0;
          return <span key={i} style={{ width: 5, borderRadius: 2, height: h, transformOrigin: 'center', background: voice ? PINK : 'rgba(255,255,255,0.45)', opacity: (sin && voice) ? 0.1 : 1, animation: `otuWave 0.9s ease-in-out infinite ${(i % 5) * 0.12}s`, transition: 'opacity .25s' }} />;
        })}
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: sin ? GOLD : PINK }}>{sin ? 'Sin voz · instrumental' : 'Con voz'}</span>
      <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 9, color: 'rgba(255,255,255,0.45)' }}>toca ▸</span>
    </div>
  );
}

// ── Lyrics-video preview — words appear over the music like the real video. ──
function LyricsMedia() {
  const lines = ['Desde el día que llegaste', 'todo cambió para bien', 'y hoy te canto esta canción', 'con todo el corazón'];
  return (
    <div style={{ position: 'relative', height: MEDIA_H, background: 'linear-gradient(135deg,#2a1245,#120b22)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>♪ LETRA SINCRONIZADA</span>
      <div style={{ position: 'relative', width: '100%', height: 24, textAlign: 'center' }}>
        {lines.map((l, i) => (
          <span key={i} style={{ position: 'absolute', left: 6, right: 6, fontSize: 13, fontWeight: 700, color: '#fff', textShadow: '0 1px 8px rgba(0,0,0,0.6)', opacity: 0, animation: `otuLyric 8s ease-in-out ${i * 2}s infinite` }}>{l}</span>
        ))}
      </div>
      <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.12)' }}>
        <span style={{ display: 'block', height: '100%', width: '45%', background: 'linear-gradient(90deg,#a855f7,#f6589f)' }} />
      </span>
    </div>
  );
}

function Media({ media, tall }) {
  if (!media) return null;
  if (media.type === 'video') return <VideoMedia src={media.src} tall={tall} />;
  if (media.type === 'ab') return <AbMedia />;
  if (media.type === 'lyrics') return <LyricsMedia />;
  return null;
}

const boxStyle = (done) => ({
  borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column',
  border: done ? `1.5px solid ${GREEN}` : '1px solid rgba(255,255,255,0.12)',
  background: done ? 'rgba(95,207,138,0.08)' : 'rgba(255,255,255,0.03)',
  animation: 'otuIn 0.5s ease-out both',
});

const addBtn = (processing) => ({
  width: '100%', border: 'none', borderRadius: 9, padding: '9px', marginTop: 8,
  background: GOLD, color: '#3a2a06', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
  cursor: processing ? 'default' : 'pointer', opacity: processing ? 0.85 : 1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
});

// One product box (animado / instrumental / lyric_video). "Agregar" never
// charges directly — it flips the box into a CONFIRM state that spells out the
// charge, so a saved-card purchase is always a deliberate two-tap action.
const FEATURES = {
  animado: ['Su rostro convertido en personaje animado', 'Ilustraciones de su historia, escena por escena', 'Movimiento en los momentos clave, al ritmo de la canción', 'Intro mágica: su foto real "cobra vida"', 'Video HD listo para compartir o proyectar'],
  instrumental: ['La misma canción, solo la música — sin la voz', 'Para que la canten ustedes (karaoke)', 'MP3 en calidad estudio'],
  lyric_video: ['Tu canción en video con la letra en pantalla', 'La letra aparece e ilumina al ritmo de la música', 'Vertical HD — listo para WhatsApp y redes'],
  gift: ['Le llega por mensaje el día y la hora que elijas', 'Con tu nombre y tu mensaje personal', 'Incluye el enlace para escuchar su canción'],
};
const DELIVERY = {
  animado: 'Hecho a mano y revisado por nuestro equipo · listo en 1–2 días · garantía de calidad',
  instrumental: 'Lista en ~1 minuto · te avisamos por email',
  lyric_video: 'Lista en unos minutos · te avisamos por email',
  gift: 'Se programa al instante para la fecha que elijas',
};
const DESC = {
  animado: 'Convertimos su rostro en un personaje animado y damos vida a su historia en un video con movimiento, al ritmo de su canción. El regalo que los hace llorar de emoción.',
  instrumental: 'La misma canción, pero solo con la música — sin la voz. Para que la canten ustedes, la usen de fondo o la disfruten en versión karaoke.',
  lyric_video: 'Tu canción convertida en un video vertical con la letra apareciendo en pantalla al ritmo de la música. Perfecto para compartir por WhatsApp o redes.',
  gift: 'En vez de mandar tú el enlace, nosotros le enviamos la canción por mensaje el día y la hora que elijas — con tu nombre y tu mensaje. La sorpresa perfecta.',
};

function FeatureList({ keyName }) {
  return (
    <ul style={{ margin: '0 0 10px', padding: 0, listStyle: 'none' }}>
      {(FEATURES[keyName] || []).map((f, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'rgba(255,255,255,0.82)', lineHeight: 1.4, marginBottom: 6 }}>
          <span style={{ color: GREEN, flexShrink: 0, marginTop: 1, fontWeight: 700 }}>✓</span>{f}
        </li>
      ))}
    </ul>
  );
}

// One product box (animado / instrumental / lyric_video). Tapping "Ver más"
// opens a full-width detail view (what's included) and only the blue
// "Sí, cobrar" there charges the saved card — info first, deliberate purchase.
function ProductBox({ item, status, onAdd, last4 }) {
  const { key, title, sub, price, media } = item;
  const done = status === 'done';
  const processing = status === 'processing';
  const needs = status === 'needs_action';
  const error = status === 'error';
  const [open, setOpen] = useState(false);
  const cardTxt = last4 && last4 !== '••••' ? `···· ${last4}` : 'guardada';

  if (!open || done) {
    return (
      <div style={boxStyle(done)}>
        {!done && <Media media={media} />}
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', flex: 1 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#fff', lineHeight: 1.25 }}>{title}</p>
          {sub && <p style={{ margin: '3px 0 0', fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.3 }}>{sub}</p>}
          <div style={{ flex: 1 }} />
          <p style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 800, color: GOLD }}>${price}</p>
          {done ? (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, fontWeight: 700, color: GREEN }}>✓ Agregado</p>
          ) : needs ? (
            <p style={{ margin: '8px 0 0', fontSize: 10.5, color: '#fcd34d', lineHeight: 1.35 }}>Tu banco pide confirmar. Escríbenos y lo agregamos.</p>
          ) : (
            <button onClick={() => setOpen(true)} style={addBtn(false)}>Ver más · ${price}</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ gridColumn: '1 / -1', ...boxStyle(false) }}>
      <Media media={media} tall />
      <div style={{ padding: 13 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</p>
          <span style={{ fontSize: 18, fontWeight: 800, color: GOLD }}>${price}</span>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'rgba(255,255,255,0.68)', lineHeight: 1.5 }}>{DESC[key] || sub}</p>
        <p style={{ margin: '0 0 7px', fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.6 }}>QUÉ INCLUYE</p>
        <FeatureList keyName={key} />
        <p style={{ margin: '0 0 13px', fontSize: 10.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>🤚 {DELIVERY[key]}</p>
        {processing ? (
          <button disabled style={{ ...addBtn(true), background: BLUE, color: '#fff' }}><Spinner color="#fff" /> Cobrando…</button>
        ) : (
          <>
            <p style={{ margin: '0 0 7px', fontSize: 10.5, color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
              Se cobra <strong style={{ color: '#fff' }}>${price}</strong> ahora a tu tarjeta {cardTxt}
            </p>
            {error && <p style={{ margin: '0 0 7px', fontSize: 11, color: '#f3a0a0', textAlign: 'center' }}>No se pudo. Intenta de nuevo.</p>}
            <button onClick={() => onAdd(key)} style={{ ...addBtn(false), background: BLUE, color: '#fff' }}>✓ Sí, cobrar ${price}</button>
            <button onClick={() => setOpen(false)} style={{ width: '100%', marginTop: 6, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
          </>
        )}
      </div>
    </div>
  );
}

// Gift box — collapsed it's a normal box; tapping "Agregar" expands it to FULL
// width (spans both columns) to show the SMS form, then charges the saved card.
function GiftBox({ item, status, onAdd, recipientName, senderName }) {
  const { title, sub, price, media } = item;
  const done = status === 'done';
  const processing = status === 'processing';
  const error = status === 'error';
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [rname, setRname] = useState(recipientName && recipientName !== 'tu ser querido' ? recipientName : '');
  const [buyer, setBuyer] = useState(senderName || '');
  const [msg, setMsg] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [att, setAtt] = useState(false);
  const [err, setErr] = useState('');

  const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(246,88,159,0.3)', color: '#fff', fontFamily: 'inherit', fontSize: 13, marginBottom: 8, outline: 'none' };

  const submit = () => {
    setErr('');
    if (phone.replace(/\D/g, '').length < 10) return setErr('Escribe un número de celular válido.');
    if (!buyer.trim()) return setErr('Escribe tu nombre.');
    if (!msg.trim()) return setErr('Escribe un mensaje.');
    if (!date || !time) return setErr('Elige el día y la hora.');
    if (!att) return setErr('Confirma que es un regalo bienvenido.');
    const local = new Date(`${date}T${time}`);
    if (isNaN(local.getTime()) || local.getTime() < Date.now() + 2 * 60 * 1000) return setErr('Elige una hora futura.');
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
    onAdd('gift', { recipient_phone: phone.trim(), recipient_name: rname.trim(), buyer_name: buyer.trim(), personal_message: msg.trim(), send_at: local.toISOString(), buyer_timezone: tz, attestation: true });
  };

  // Collapsed / done → normal product box.
  if (!open || done) {
    const needs = status === 'needs_action';
    return (
      <div style={boxStyle(done)}>
        {!done && <Media media={media} />}
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', flex: 1 }}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#fff', lineHeight: 1.25 }}>{title}</p>
          {sub && <p style={{ margin: '3px 0 0', fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.3 }}>{sub}</p>}
          <div style={{ flex: 1 }} />
          <p style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 800, color: GOLD }}>${price}</p>
          {done ? (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, fontWeight: 700, color: GREEN }}>✓ Programado</p>
          ) : needs ? (
            <p style={{ margin: '8px 0 0', fontSize: 10.5, color: '#fcd34d', lineHeight: 1.35 }}>Tu banco pide confirmar. Escríbenos.</p>
          ) : (
            <button onClick={() => setOpen(true)} style={addBtn(false)}>Ver más · ${price}</button>
          )}
        </div>
      </div>
    );
  }

  // Open → full-width form.
  return (
    <div style={{ gridColumn: '1 / -1', ...boxStyle(false) }}>
      <div style={{ padding: 13 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</p>
          <span style={{ fontSize: 18, fontWeight: 800, color: GOLD }}>${price}</span>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'rgba(255,255,255,0.68)', lineHeight: 1.5 }}>{DESC.gift}</p>
        <p style={{ margin: '0 0 7px', fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.6 }}>QUÉ INCLUYE</p>
        <FeatureList keyName="gift" />
        <p style={{ margin: '0 0 13px', fontSize: 10.5, color: 'rgba(255,255,255,0.4)' }}>🤚 {DELIVERY.gift}</p>
        <input style={inp} type="tel" placeholder="Celular del destinatario" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input style={inp} placeholder="Nombre de quien recibe" value={rname} onChange={(e) => setRname(e.target.value)} />
        <input style={inp} placeholder="Tu nombre" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
        <textarea style={{ ...inp, resize: 'none' }} rows={2} placeholder="Tu mensaje personal" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...inp, flex: 1 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input style={{ ...inp, flex: 1 }} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: 'rgba(255,255,255,0.6)', margin: '2px 0 10px', cursor: 'pointer' }}>
          <input type="checkbox" checked={att} onChange={(e) => setAtt(e.target.checked)} style={{ marginTop: 2 }} />
          Confirmo que es un regalo bienvenido para esta persona.
        </label>
        {(err || error) && <p style={{ margin: '0 0 9px', fontSize: 11.5, color: '#f3a0a0' }}>{err || 'No se pudo agregar. Revisa los datos e intenta de nuevo.'}</p>}
        <button onClick={submit} disabled={processing} style={{ ...addBtn(processing), marginTop: 0, background: BLUE, color: '#fff' }}>
          {processing ? <><Spinner color="#fff" /> Programando…</> : <>Programar y cobrar ${price} — un toque</>}
        </button>
      </div>
    </div>
  );
}

export function OneTapUpsell({ recipientName = 'tu ser querido', senderName = '', last4 = '••••', items = null, onCharge = null }) {
  const catalog = items || [
    { key: 'animado', price: 49, title: 'Película animada', sub: 'Su rostro hecho personaje', media: { type: 'video', src: '/animado-sample.mp4' } },
    { key: 'instrumental', price: 7.99, title: 'Pista instrumental', sub: 'Solo la música, para cantar', media: { type: 'ab' } },
    { key: 'lyric_video', price: 9.99, title: 'Video con letra', sub: 'La letra en pantalla', media: { type: 'lyrics' } },
    { key: 'gift', price: 5, title: 'Enviar por mensaje', sub: 'Sorpresa el día que elijas', media: { type: 'video', src: '/sms-reaction.mp4' }, form: 'gift' },
  ];

  const [statuses, setStatuses] = useState({});

  const handleAdd = async (key, payload) => {
    setStatuses((s) => ({ ...s, [key]: 'processing' }));
    try {
      const run = onCharge || (() => new Promise((res) => setTimeout(() => res({ status: 'paid' }), 1400)));
      const result = await run(key, payload);
      const next = result?.status === 'paid' ? 'done' : result?.status === 'needs_action' ? 'needs_action' : 'error';
      setStatuses((s) => ({ ...s, [key]: next }));
    } catch {
      setStatuses((s) => ({ ...s, [key]: 'error' }));
    }
  };

  return (
    <div style={{ maxWidth: 460, margin: '0 auto' }}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' }}>
        <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>Hazlo aún más especial</span>
        <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
      </div>
      <p style={{ margin: '0 0 14px', textAlign: 'center', fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
        {last4 && last4 !== '••••'
          ? <>Un toque · se cobra a tu tarjeta ···· {last4}, sin volver a pagar</>
          : <>Un toque · se cobra a tu tarjeta guardada, sin volver a pagar</>}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
        {catalog.map((item) => (
          item.form === 'gift'
            ? <GiftBox key={item.key} item={item} status={statuses[item.key]} onAdd={handleAdd} recipientName={recipientName} senderName={senderName} />
            : <ProductBox key={item.key} item={item} status={statuses[item.key]} onAdd={handleAdd} last4={last4} />
        ))}
      </div>
      <p style={{ margin: '14px 0 0', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.32)', lineHeight: 1.5 }}>
        🔒 Pago seguro · revisado a mano antes de enviártelo · garantía de calidad
      </p>
    </div>
  );
}

// ── Local demo (route /upsell-demo) ──
export default function OneTapUpsellDemo() {
  return (
    <div style={{ background: '#0c0810', minHeight: '100vh', padding: '28px 16px 80px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 460, margin: '0 auto 22px', textAlign: 'center', color: '#fff' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(95,207,138,0.12)', color: '#7fd99f', fontSize: 11.5, fontWeight: 600, padding: '5px 13px', borderRadius: 50 }}>✓ Pago confirmado</span>
        <h1 style={{ margin: '12px 0 2px', fontSize: 23, fontWeight: 800 }}>La canción de <span style={{ color: PINK }}>María</span> ya está lista</h1>
        <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>Descárgala, compártela — y si quieres, hazla aún más especial</p>
      </div>
      <OneTapUpsell recipientName="María" senderName="Gerardo" last4="4242" />
    </div>
  );
}
