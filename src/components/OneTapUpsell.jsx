import React, { useState, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// OneTapUpsell — post-purchase secondary upsell shown on the buyer's /success
// page AFTER the song is delivered. Because the song checkout saved the card
// off-session (create-checkout) and stripe-webhook stored the Stripe customer +
// payment method on the song, each "Agregar" here is a SINGLE TAP that charges
// the saved card — no second checkout, no card re-entry.
//
// Every item carries a real PREVIEW of what it delivers ("preview the
// deliverable"): a video for Animado / SMS, a con-voz/sin-voz toggle for the
// instrumental, an animated lyrics mock for the lyric video.
//
//   item: { key, hero, icon, price, title, sub, media }
//     media: { type:'video', src } | { type:'ab' } | { type:'lyrics' }
//   onCharge(itemKey) -> Promise<{ status:'paid'|'needs_action'|'error' }>
//
// Default export = a self-contained DEMO (route /upsell-demo).
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = '#f5b942';
const PINK = '#f6589f';
const GREEN = '#5fcf8a';

const CSS = `
@keyframes otuSpin{to{transform:rotate(360deg)}}
@keyframes otuIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes otuWave{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
@keyframes otuLyric{0%,6%{opacity:0;transform:translateY(7px)}18%,82%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-7px)}}
`;

function Spinner({ color = GOLD }) {
  return <span style={{ width: 17, height: 17, borderRadius: '50%', display: 'inline-block', border: `2px solid ${color}40`, borderTopColor: color, animation: 'otuSpin 0.7s linear infinite' }} />;
}

// ── Real video preview (Animado sample, SMS reaction). Autoplays muted + loops;
//    tap to hear sound. "Muestra real" badge since these are genuine outputs. ──
function VideoPreview({ src, width = 168 }) {
  const ref = useRef(null);
  const [muted, setMuted] = useState(true);
  const toggle = () => { const v = ref.current; if (!v) return; const n = !muted; v.muted = n; setMuted(n); if (!n) v.play().catch(() => {}); };
  return (
    <div style={{ position: 'relative', width, margin: '0 auto', borderRadius: 14, overflow: 'hidden', border: '2px solid rgba(245,185,66,0.4)', background: '#0d0a12' }}>
      <video ref={ref} src={src} muted loop playsInline autoPlay onClick={toggle}
        style={{ display: 'block', width: '100%', aspectRatio: '9/16', objectFit: 'cover', cursor: 'pointer' }} />
      <span style={{ position: 'absolute', top: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.55)', padding: '3px 8px', borderRadius: 20, fontSize: 10, color: '#fff', fontWeight: 700 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, display: 'inline-block' }} />Muestra real
      </span>
      <button onClick={toggle} style={{ position: 'absolute', bottom: 8, right: 8, border: 'none', cursor: 'pointer', background: muted ? 'rgba(247,77,166,0.92)' : 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '5px 9px', borderRadius: 20 }}>
        {muted ? '🔇 oír' : '🔊'}
      </button>
    </div>
  );
}

// ── Instrumental con-voz / sin-voz preview. Toggling drops the "voice" bars so
//    the buyer sees exactly what the instrumental is — the music without the voice. ──
function AbPreview() {
  const [mode, setMode] = useState('voz');
  const bars = [12, 18, 24, 15, 27, 33, 21, 13, 29, 35, 19, 25, 31, 16, 22, 28, 12, 20, 34, 24];
  const tab = (on) => ({ flex: 1, border: 'none', borderRadius: 8, padding: '7px', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: on ? '#f20d80' : 'transparent', color: on ? '#fff' : 'rgba(255,255,255,0.55)' });
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 11 }}>
      <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: 9, padding: 3, marginBottom: 10 }}>
        <button style={tab(mode === 'voz')} onClick={() => setMode('voz')}>Con voz</button>
        <button style={tab(mode === 'sin')} onClick={() => setMode('sin')}>Sin voz · instrumental</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#f20d80', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>▶</span>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, height: 34 }}>
          {bars.map((h, i) => {
            const voice = i % 3 === 0;
            return <span key={i} style={{ flex: 1, borderRadius: 2, height: h, transformOrigin: 'center', background: voice ? '#f6589f' : 'rgba(255,255,255,0.4)', opacity: (mode === 'sin' && voice) ? 0.12 : 1, animation: `otuWave 0.9s ease-in-out infinite ${(i % 5) * 0.12}s`, transition: 'opacity .25s' }} />;
          })}
        </div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 10.5, fontWeight: 600, color: mode === 'sin' ? GOLD : PINK }}>
        {mode === 'sin' ? '▶ Solo la música — sin voz, para cantar tú' : '▶ Tu canción, con la voz cantando'}
      </p>
    </div>
  );
}

// ── Lyrics-video preview: a mock of the deliverable — the song's words appearing
//    and highlighting over the music, the way the real lyric video plays. ──
function LyricsPreview() {
  const lines = ['Desde el día que llegaste', 'todo cambió para bien', 'y hoy te canto esta canción', 'con todo mi corazón'];
  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', height: 96, background: 'linear-gradient(135deg,#2a1245,#120b22)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ position: 'absolute', top: 7, left: 8, fontSize: 9.5, color: 'rgba(255,255,255,0.5)', fontWeight: 700, letterSpacing: 0.5 }}>♪ LETRA SINCRONIZADA</span>
      <div style={{ position: 'relative', width: '100%', height: 30, textAlign: 'center' }}>
        {lines.map((l, i) => (
          <span key={i} style={{ position: 'absolute', left: 0, right: 0, fontSize: 14, fontWeight: 700, color: '#fff', textShadow: '0 1px 8px rgba(0,0,0,0.6)', opacity: 0, animation: `otuLyric 8s ease-in-out ${i * 2}s infinite` }}>{l}</span>
        ))}
      </div>
      <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.12)' }}>
        <span style={{ display: 'block', height: '100%', width: '45%', background: 'linear-gradient(90deg,#a855f7,#f6589f)' }} />
      </span>
    </div>
  );
}

function Media({ media, hero }) {
  if (!media) return null;
  let inner = null;
  if (media.type === 'video') inner = <VideoPreview src={media.src} width={hero ? 184 : 150} />;
  else if (media.type === 'ab') inner = <AbPreview />;
  else if (media.type === 'lyrics') inner = <LyricsPreview />;
  if (!inner) return null;
  return <div style={{ marginBottom: 13 }}>{inner}</div>;
}

// SMS gift card — needs a tiny form (phone / message / date) before the saved-card
// charge, so it's "fill → one tap." Message is moderated server-side (charge-upsell).
function GiftCard({ item, status, onAdd, recipientName, senderName }) {
  const { price, media, title, sub, icon } = item;
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

  return (
    <div style={{ position: 'relative', border: done ? `1.5px solid ${GREEN}` : '1.5px solid rgba(255,255,255,0.12)', background: done ? 'rgba(95,207,138,0.08)' : 'transparent', borderRadius: 16, padding: 13, animation: 'otuIn 0.5s ease-out both' }}>
      {!done && <Media media={media} />}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: PINK, fontSize: 19 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#fff' }}>{title}</p>
          <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.35 }}>{sub}</p>
        </div>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', flexShrink: 0 }}>${price}</span>
      </div>

      {done ? (
        <p style={{ margin: '12px 0 0', textAlign: 'right', color: GREEN, fontSize: 13.5, fontWeight: 700 }}>✓ Programado · le llegará la sorpresa</p>
      ) : !open ? (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setOpen(true)} style={btnStyle(false)}>⚡ Agregar — un toque</button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
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
          <button onClick={submit} disabled={processing} style={{ ...btnStyle(true, processing), width: '100%', justifyContent: 'center' }}>
            {processing ? <><Spinner color="#3a2a06" /> Programando…</> : <>Programar y cobrar ${price} — un toque</>}
          </button>
        </div>
      )}
    </div>
  );
}

function UpsellCard({ item, status, onAdd }) {
  const { key, hero, icon, title, sub, price, media } = item;
  const done = status === 'done';
  const processing = status === 'processing';
  const needs = status === 'needs_action';
  const error = status === 'error';

  return (
    <div style={{
      position: 'relative',
      border: done ? `1.5px solid ${GREEN}` : hero ? '1.5px solid rgba(245,185,66,0.5)' : '1.5px solid rgba(255,255,255,0.12)',
      background: done ? 'rgba(95,207,138,0.08)' : hero ? 'rgba(245,185,66,0.05)' : 'transparent',
      borderRadius: 16, padding: hero ? 16 : 13,
      transition: 'all 0.25s', animation: 'otuIn 0.5s ease-out both',
    }}>
      {hero && !done && (
        <span style={{ position: 'absolute', top: -9, left: 16, background: GOLD, color: '#3a2a06', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 6, zIndex: 1 }}>Más regalado</span>
      )}

      {!done && <Media media={media} hero={hero} />}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ width: hero ? 44 : 40, height: hero ? 44 : 40, borderRadius: 11, flexShrink: 0, background: hero ? '#2a1d10' : 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hero ? GOLD : PINK, fontSize: hero ? 21 : 19 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: hero ? 15 : 14, fontWeight: 700, color: '#fff' }}>{title}</p>
          <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.35 }}>{sub}</p>
        </div>
        <span style={{ fontSize: hero ? 17 : 15, fontWeight: 800, color: hero ? GOLD : '#fff', flexShrink: 0 }}>${price}</span>
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        {done ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: GREEN, fontSize: 13.5, fontWeight: 700 }}>✓ Agregado · te lo enviamos por email</span>
        ) : needs ? (
          <span style={{ fontSize: 12, color: '#fcd34d', textAlign: 'right', maxWidth: 230, lineHeight: 1.4 }}>Tu banco pide confirmar este cargo. Escríbenos y lo agregamos en un momento.</span>
        ) : (
          <button onClick={() => onAdd(key)} disabled={processing} style={btnStyle(hero, processing)}>
            {processing ? <><Spinner color={hero ? '#3a2a06' : GOLD} /> Cobrando…</> : <>⚡ Agregar — un toque</>}
          </button>
        )}
      </div>

      {error && <p style={{ margin: '9px 0 0', fontSize: 11.5, color: '#f3a0a0', textAlign: 'right' }}>No se pudo agregar. Intenta de nuevo.</p>}
    </div>
  );
}

function btnStyle(filled, processing = false) {
  return {
    border: filled ? 'none' : `1.5px solid ${GOLD}`, borderRadius: 50,
    padding: filled ? '11px 18px' : '9px 16px',
    background: filled ? GOLD : 'transparent', color: filled ? '#3a2a06' : GOLD,
    fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
    cursor: processing ? 'default' : 'pointer', opacity: processing ? 0.85 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 7, transition: 'all 0.2s',
  };
}

export function OneTapUpsell({ recipientName = 'tu ser querido', senderName = '', last4 = '••••', items = null, onCharge = null }) {
  const catalog = items || [
    { key: 'animado', hero: true, icon: '🎬', price: 49, title: `Película animada de ${recipientName}`, sub: 'Su rostro hecho personaje, al ritmo de su canción', media: { type: 'video', src: '/animado-sample.mp4' } },
    { key: 'instrumental', icon: '🎤', price: 7.99, title: 'Pista instrumental', sub: 'Solo la música, para cantar encima', media: { type: 'ab' } },
    { key: 'lyric_video', icon: '🎬', price: 9.99, title: 'Video con letra', sub: 'Tu canción con la letra en pantalla, lista para compartir', media: { type: 'lyrics' } },
    { key: 'gift', icon: '🎁', price: 5, title: 'Enviar de sorpresa por mensaje', sub: 'El día y la hora que elijas, con tu nombre', media: { type: 'video', src: '/sms-reaction.mp4' }, form: 'gift' },
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
      <p style={{ margin: '0 0 16px', textAlign: 'center', fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
        {last4 && last4 !== '••••'
          ? <>Un toque · se cobra a tu tarjeta ···· {last4}, sin volver a pagar</>
          : <>Un toque · se cobra a tu tarjeta guardada, sin volver a pagar</>}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {catalog.map((item) => (
          item.form === 'gift'
            ? <GiftCard key={item.key} item={item} status={statuses[item.key]} onAdd={handleAdd} recipientName={recipientName} senderName={senderName} />
            : <UpsellCard key={item.key} item={item} status={statuses[item.key]} onAdd={handleAdd} />
        ))}
      </div>
      <p style={{ margin: '16px 0 0', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.32)', lineHeight: 1.5 }}>
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
      <OneTapUpsell recipientName="María" last4="4242" />
    </div>
  );
}
