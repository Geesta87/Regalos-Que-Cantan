import React, { useMemo, useState } from 'react';

// GiftTextUpsell — the $5 "send this song as a scheduled surprise text" add-on.
//
// Self-contained: renders the pink hero card, opens the gift modal, validates,
// converts the buyer's chosen LOCAL day/time to a UTC instant using the buyer's
// own timezone, and POSTs to the create-gift-checkout edge function (which runs
// a moderation pass before any charge). On success it redirects to Stripe.
//
// Reusable: drop <GiftTextUpsell song={...} supabaseUrl={...} anonKey={...} />
// onto any page that has a paid song (SuccessPage today; SongPage later).
//
// Props:
//   song        — the paid song row (id, recipient_name, sender_name, email)
//   supabaseUrl — VITE_SUPABASE_URL
//   anonKey     — VITE_SUPABASE_ANON_KEY

const PINK = '#f20d80';
const PINK_DARK = '#c70a64';

function todayLocalISODate() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export default function GiftTextUpsell({ song, supabaseUrl, anonKey }) {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const justScheduled = params.get('gift') === 'scheduled';

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [recipientName, setRecipientName] = useState(song?.recipient_name || '');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [buyerName, setBuyerName] = useState(song?.sender_name || '');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [attested, setAttested] = useState(false);

  const buyerTimezone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
  }, []);

  // ---- Already scheduled (returned from Stripe) → confirmation card ----
  if (justScheduled) {
    return (
      <div style={{ background: '#150a12', borderRadius: '16px', padding: '22px 18px', marginBottom: '24px', border: `1px solid rgba(242,13,128,0.3)`, textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '8px' }}>🎁</div>
        <h3 style={{ fontSize: '20px', fontWeight: 900, color: '#ffd6e8', margin: '0 0 6px' }}>¡Envío programado!</h3>
        <p style={{ fontSize: '14px', color: '#e7b9cf', margin: 0, lineHeight: 1.5 }}>
          Le enviaremos la canción por mensaje el día y la hora que elegiste. 💕
        </p>
      </div>
    );
  }

  async function handleSubmit() {
    setError(null);
    if (!recipientPhone.trim()) return setError('Escribe el número de celular del destinatario.');
    if (!phoneConfirmed) return setError('Confirma que el número es correcto.');
    if (!buyerName.trim()) return setError('Escribe tu nombre (así sabrán quién lo envía).');
    if (!date || !time) return setError('Elige el día y la hora de envío.');
    if (!attested) return setError('Confirma que es un regalo bienvenido.');

    const local = new Date(`${date}T${time}`);
    if (isNaN(local.getTime())) return setError('La fecha y hora no son válidas.');
    if (local.getTime() < Date.now() + 2 * 60 * 1000) return setError('Elige una hora en el futuro.');

    setSubmitting(true);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/create-gift-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({
          song_id: song.id,
          recipient_name: recipientName.trim() || null,
          recipient_phone: recipientPhone.trim(),
          buyer_name: buyerName.trim(),
          personal_message: message.trim(),
          send_at: local.toISOString(),
          buyer_timezone: buyerTimezone,
          email: song?.email || undefined,
          attestation: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || 'No se pudo continuar. Intenta de nuevo.');
        setSubmitting(false);
        return;
      }
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      setError('No se recibió el enlace de pago. Intenta de nuevo.');
      setSubmitting(false);
    } catch (e) {
      setError('Error de conexión. Intenta de nuevo.');
      setSubmitting(false);
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '10px',
    background: '#0f0a12', color: '#fff',
    border: '1px solid rgba(242,13,128,0.3)', fontSize: '15px',
    fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '12px',
  };
  const labelStyle = { fontSize: '12px', color: '#c98fab', display: 'block', marginBottom: '4px' };

  return (
    <>
      {/* ===== PINK HERO CARD ===== */}
      <div style={{ background: '#150a12', borderRadius: '16px', padding: '18px', marginBottom: '24px', border: '1px solid rgba(242,13,128,0.25)' }}>
        <div style={{ height: '2px', borderRadius: '2px', marginBottom: '16px', background: `linear-gradient(90deg, transparent, ${PINK}, #f97bb6, ${PINK}, transparent)` }} />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '18px' }}>
          <div style={{ width: '54px', height: '54px', minWidth: '54px', borderRadius: '16px', background: `linear-gradient(135deg, ${PINK}, ${PINK_DARK})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px' }}>🎁</div>
          <div>
            <h3 style={{ fontSize: '22px', fontWeight: 900, margin: '0 0 6px', color: '#ffd6e8', lineHeight: 1.15 }}>
              No se la mandes tú... que le llegue solita el día perfecto
            </h3>
            <p style={{ fontSize: '14px', color: '#e7b9cf', lineHeight: 1.45, margin: '0 0 6px' }}>
              Se la enviamos por mensaje el día y la hora que elijas — con tu nombre 💕
            </p>
            <p style={{ fontSize: '12px', color: '#f97bb6', fontWeight: 600, margin: 0 }}>💝 El detalle que nadie se espera</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(135deg, rgba(242,13,128,0.15), rgba(199,10,100,0.08))', border: '1px solid rgba(242,13,128,0.25)', borderRadius: '14px', padding: '12px 16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '32px', fontWeight: 900, color: '#ffd6e8' }}>$5</span>
            <span style={{ fontSize: '11px', color: '#e7b9cf' }}>USD</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '11px', color: '#f97bb6', margin: '0 0 2px', fontWeight: 600 }}>✓ Tú eliges el día</p>
            <p style={{ fontSize: '11px', color: '#f97bb6', margin: 0, fontWeight: 600 }}>✓ Llega con tu nombre</p>
          </div>
        </div>

        <button onClick={() => setOpen(true)} style={{ width: '100%', padding: '15px', background: `linear-gradient(135deg, ${PINK}, ${PINK_DARK})`, color: '#fff', fontWeight: 800, fontSize: '15px', border: 'none', borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🎁</span>
          <span>Enviárselo de sorpresa — $5</span>
          <span style={{ marginLeft: 'auto', fontSize: '18px', opacity: 0.7 }}>→</span>
        </button>
      </div>

      {/* ===== MODAL ===== */}
      {open && (
        <div onClick={() => !submitting && setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '420px', background: '#1c1018', borderRadius: '16px', border: '1px solid rgba(242,13,128,0.25)', padding: '20px', maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <span style={{ fontSize: '22px' }}>🎁</span>
              <p style={{ margin: 0, fontWeight: 800, fontSize: '17px', color: '#ffd6e8' }}>Envíaselo de sorpresa</p>
              <button onClick={() => setOpen(false)} disabled={submitting} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#a98', fontSize: '22px', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: '12px', color: '#d8b3c6', lineHeight: 1.5 }}>
              Le mandamos su canción por mensaje el día y la hora que elijas.
            </p>

            <label style={labelStyle}>¿Para quién es?</label>
            <input style={inputStyle} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Ej. Abuela Rosa" />

            <label style={labelStyle}>Su número de celular</label>
            <input style={{ ...inputStyle, marginBottom: '6px' }} value={recipientPhone} onChange={(e) => { setRecipientPhone(e.target.value); setPhoneConfirmed(false); }} placeholder="(305) 555-0148" inputMode="tel" />
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: '#d8b3c6', marginBottom: '12px', cursor: 'pointer' }}>
              <input type="checkbox" checked={phoneConfirmed} onChange={(e) => setPhoneConfirmed(e.target.checked)} style={{ marginTop: '2px', accentColor: PINK }} />
              <span>Confirmo que <strong style={{ color: '#ffd6e8' }}>{recipientPhone || 'este número'}</strong> es correcto.</span>
            </label>

            <label style={labelStyle}>Tu nombre <span style={{ color: '#f97bb6' }}>(verá quién se lo manda)</span></label>
            <input style={inputStyle} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Tu nombre" />

            <label style={labelStyle}>Mensaje personal</label>
            <textarea style={{ ...inputStyle, resize: 'none', minHeight: '64px' }} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 300))} placeholder="Ej. ¡Feliz cumpleaños! Te hice esta canción con todo mi cariño 💕" />

            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Día</label>
                <input type="date" min={todayLocalISODate()} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Hora</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: '#d8b3c6', marginBottom: '14px', cursor: 'pointer', background: 'rgba(242,13,128,0.08)', padding: '10px', borderRadius: '10px' }}>
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} style={{ marginTop: '2px', accentColor: PINK }} />
              <span>Confirmo que es un regalo para alguien a quien le dará gusto recibirlo.</span>
            </label>

            {error && (
              <p style={{ color: '#ff9ec4', fontSize: '13px', margin: '0 0 12px', textAlign: 'center' }}>{error}</p>
            )}

            <button onClick={handleSubmit} disabled={submitting} style={{ width: '100%', padding: '14px', background: submitting ? 'rgba(242,13,128,0.5)' : `linear-gradient(135deg, ${PINK}, ${PINK_DARK})`, color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 800, cursor: submitting ? 'wait' : 'pointer' }}>
              {submitting ? 'Redirigiendo al pago…' : 'Programar envío · $5'}
            </button>

            <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#a98', lineHeight: 1.5, display: 'flex', gap: '6px' }}>
              <span style={{ flexShrink: 0 }}>🛡️</span>
              <span>Revisamos el mensaje antes de enviarlo. El texto dirá quién lo manda e incluirá la opción de responder STOP.</span>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
