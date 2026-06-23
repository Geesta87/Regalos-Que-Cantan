import React from 'react';
import { guessTimezoneFromPhone, tzLabel, format12, tzOptionsWith } from '../utils/recipientTimezone';

// GiftAddonField — controlled "send it as a scheduled surprise text (+$5)" add-on
// for the comparison page. Unlike GiftTextUpsell (post-purchase, its own
// checkout), this is a bundled checkbox: it reports its state up via onChange and
// the parent folds it into the single main checkout. A checkbox that expands to
// reveal the recipient/message/schedule fields when ticked.
//
// Props:
//   value            — gift state object (see ComparisonPage initial state)
//   onChange(next)   — parent setter (merge patch)
//   recipientDefault — prefill for "para quién" (the song's recipient)
//   senderDefault    — prefill for "tu nombre" (the song's sender)
//   error            — server/client validation message to show inline

const PINK = '#f20d80';
const PINK_DARK = '#c70a64';

function todayLocalISODate() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export default function GiftAddonField({ value, onChange, recipientDefault = '', senderDefault = '', error }) {
  const v = value;
  const set = (patch) => onChange({ ...v, ...patch });
  const buyerTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/New_York'; } })();
  const effectiveTz = v.tz || guessTimezoneFromPhone(v.phone) || buyerTz || 'America/New_York';

  const toggle = () => {
    if (!v.enabled) {
      set({ enabled: true, recipientName: v.recipientName || recipientDefault, buyerName: v.buyerName || senderDefault });
    } else {
      set({ enabled: false });
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '10px',
    background: 'rgba(0,0,0,0.35)', color: '#fff',
    border: '1px solid rgba(242,13,128,0.3)', fontSize: '15px',
    fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '10px',
  };
  const labelStyle = { fontSize: '12px', color: '#e7b9cf', display: 'block', marginBottom: '4px' };

  return (
    <div style={{ marginBottom: '16px', animation: 'fadeIn 0.6s ease-out both' }}>
      <div
        onClick={toggle}
        role="button"
        style={{
          display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer',
          background: v.enabled ? 'rgba(242,13,128,0.12)' : 'rgba(242,13,128,0.06)',
          border: v.enabled ? `2px solid ${PINK}` : '2px solid rgba(242,13,128,0.4)',
          borderRadius: '14px', padding: '12px 14px',
        }}
      >
        <span style={{
          width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0,
          border: v.enabled ? `2px solid ${PINK}` : '2px solid rgba(255,255,255,0.4)',
          background: v.enabled ? PINK : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '13px',
        }}>{v.enabled ? '✓' : ''}</span>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#fff' }}>🎁 Enviárselo de sorpresa por mensaje</p>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#e7b9cf' }}>Se la mandamos el día y la hora que elijas — con tu nombre</p>
        </div>
        <span style={{ fontSize: '15px', fontWeight: 800, color: '#ffd6e8' }}>+$5</span>
      </div>

      {v.enabled && (
        <div style={{ padding: '14px', background: 'rgba(242,13,128,0.05)', border: '1px solid rgba(242,13,128,0.25)', borderTop: 'none', borderRadius: '0 0 14px 14px', marginTop: '-2px' }}>
          <label style={labelStyle}>¿Para quién es?</label>
          <input style={inputStyle} value={v.recipientName} onChange={(e) => set({ recipientName: e.target.value })} placeholder="Ej. Abuela Rosa" />

          <label style={labelStyle}>Su número de celular</label>
          <input style={{ ...inputStyle, marginBottom: '12px' }} value={v.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="(305) 555-0148" inputMode="tel" />

          <label style={labelStyle}>Tu nombre <span style={{ color: '#f97bb6' }}>(verá quién se lo manda)</span></label>
          <input style={inputStyle} value={v.buyerName} onChange={(e) => set({ buyerName: e.target.value })} placeholder="Tu nombre" />

          <label style={labelStyle}>Mensaje personal</label>
          <textarea style={{ ...inputStyle, resize: 'none', minHeight: '60px' }} value={v.message} onChange={(e) => set({ message: e.target.value.slice(0, 300) })} placeholder="Ej. ¡Feliz cumpleaños! Te hice esta canción con todo mi cariño 💕" />

          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Día</label>
              <input type="date" min={todayLocalISODate()} value={v.date} onChange={(e) => set({ date: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Hora</label>
              <input type="time" value={v.time} onChange={(e) => set({ time: e.target.value })} style={inputStyle} />
            </div>
          </div>

          {v.phone && v.time && (
            <div style={{ margin: '4px 0 8px' }}>
              <label style={labelStyle}>Zona horaria de {v.recipientName || 'quien lo recibe'}</label>
              <select value={effectiveTz} onChange={(e) => set({ tz: e.target.value })} style={{ ...inputStyle, marginBottom: '6px' }}>
                {tzOptionsWith(effectiveTz).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p style={{ margin: 0, fontSize: '12px', color: '#f97bb6', lineHeight: 1.4 }}>
                🕒 Le llegará a las {format12(v.time)} {tzLabel(effectiveTz)}{v.recipientName ? ` — la hora de ${v.recipientName}` : ''}
              </p>
            </div>
          )}
          {error && <p style={{ color: '#ff9ec4', fontSize: '13px', margin: '8px 0 0' }}>{error}</p>}
          <p style={{ margin: '10px 0 0', fontSize: '11px', color: '#c98fab', lineHeight: 1.5 }}>
            🛡️ Al completar tu compra confirmas que es un regalo bienvenido. Revisamos el mensaje antes de enviarlo y el texto dirá quién lo manda, con opción de responder STOP.
          </p>
        </div>
      )}
    </div>
  );
}
