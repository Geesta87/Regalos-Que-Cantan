import React, { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// OneTapUpsell — post-purchase secondary upsell shown on the success page AFTER
// the song is delivered. Because the song checkout saved the card off-session
// (create-checkout) and stripe-webhook stored the Stripe customer + payment
// method on the song, each "Agregar" here is a SINGLE TAP that charges the saved
// card — no second checkout, no card re-entry.
//
//   onCharge(itemKey) -> Promise<{ status: 'paid' | 'needs_action' | 'error', message? }>
//     'paid'         → card charged, UI flips to "Agregado"
//     'needs_action' → rare: the bank wants verification; caller routes to a
//                      one-time checkout for that single item (we surface a CTA)
//     'error'        → show the message, let them retry
//
// The default export at the bottom is a self-contained DEMO (route /upsell-demo)
// so the experience can be previewed without a real paid order or Stripe.
// ─────────────────────────────────────────────────────────────────────────────

const GOLD = '#f5b942';
const PINK = '#f6589f';
const GREEN = '#5fcf8a';

const SPIN_CSS = `@keyframes otuSpin{to{transform:rotate(360deg)}}@keyframes otuIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`;

function Spinner({ color = GOLD }) {
  return (
    <span style={{
      width: 17, height: 17, borderRadius: '50%', display: 'inline-block',
      border: `2px solid ${color}40`, borderTopColor: color, animation: 'otuSpin 0.7s linear infinite',
    }} />
  );
}

// One enhancement card. `hero` styles the flagship (Animado) larger + gold.
function UpsellCard({ item, status, onAdd }) {
  const { key, hero, icon, title, sub, price } = item;
  const accent = hero ? GOLD : 'rgba(255,255,255,0.25)';
  const done = status === 'done';
  const processing = status === 'processing';
  const needs = status === 'needs_action';
  const error = status === 'error';

  return (
    <div style={{
      position: 'relative',
      border: done ? `1.5px solid ${GREEN}` : hero ? `1.5px solid rgba(245,185,66,0.5)` : '1.5px solid rgba(255,255,255,0.12)',
      background: done ? 'rgba(95,207,138,0.08)' : hero ? 'rgba(245,185,66,0.05)' : 'transparent',
      borderRadius: 16, padding: hero ? 16 : 13,
      transition: 'all 0.25s', animation: 'otuIn 0.5s ease-out both',
    }}>
      {hero && !done && (
        <span style={{
          position: 'absolute', top: -9, left: 16, background: GOLD, color: '#3a2a06',
          fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
        }}>Más regalado</span>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{
          width: hero ? 56 : 46, height: hero ? 56 : 46, borderRadius: 12, flexShrink: 0,
          background: hero ? '#2a1d10' : 'rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: hero ? GOLD : PINK, fontSize: hero ? 24 : 20,
        }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: hero ? 15 : 14, fontWeight: 700, color: '#fff' }}>{title}</p>
          <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.35 }}>{sub}</p>
        </div>
        {!hero && <span style={{ fontSize: 15, fontWeight: 800, color: '#fff', flexShrink: 0 }}>${price}</span>}
      </div>

      <div style={{ marginTop: hero ? 13 : 11, display: 'flex', alignItems: 'center', justifyContent: hero ? 'space-between' : 'flex-end' }}>
        {hero && <span style={{ fontSize: 17, fontWeight: 800, color: GOLD }}>${price}</span>}
        {done ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: GREEN, fontSize: 13.5, fontWeight: 700 }}>
            ✓ Agregado · te lo enviamos por email
          </span>
        ) : needs ? (
          <span style={{ fontSize: 12, color: '#fcd34d', textAlign: 'right', maxWidth: 230, lineHeight: 1.4 }}>
            Tu banco pide confirmar este cargo. Escríbenos y lo agregamos en un momento.
          </span>
        ) : (
          <button
            onClick={() => onAdd(key)}
            disabled={processing}
            style={btnStyle(hero, processing)}
          >
            {processing ? <><Spinner color={hero ? '#3a2a06' : GOLD} /> Cobrando…</> : <>⚡ Agregar — un toque</>}
          </button>
        )}
      </div>

      {error && (
        <p style={{ margin: '9px 0 0', fontSize: 11.5, color: '#f3a0a0', textAlign: 'right' }}>
          No se pudo agregar. Intenta de nuevo.
        </p>
      )}
    </div>
  );
}

function btnStyle(filled, processing = false) {
  return {
    border: filled ? 'none' : `1.5px solid ${GOLD}`,
    borderRadius: 50,
    padding: filled ? '11px 18px' : '9px 16px',
    background: filled ? GOLD : 'transparent',
    color: filled ? '#3a2a06' : GOLD,
    fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
    cursor: processing ? 'default' : 'pointer',
    opacity: processing ? 0.85 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 7,
    transition: 'all 0.2s',
  };
}

export function OneTapUpsell({
  recipientName = 'tu ser querido',
  last4 = '••••',
  items = null,
  onCharge = null,
}) {
  // Default catalog — the three extras that moved off the bundled checkout.
  const catalog = items || [
    { key: 'animado', hero: true, icon: '🎬', price: 49, title: `Película animada de ${recipientName}`, sub: 'Su rostro hecho personaje, al ritmo de su canción' },
    { key: 'instrumental', icon: '🎤', price: 7.99, title: 'Pista instrumental', sub: 'Solo la música, para cantar encima' },
    { key: 'gift', icon: '🎁', price: 5, title: 'Enviar de sorpresa por mensaje', sub: 'El día y la hora que elijas, con tu nombre' },
  ];

  const [statuses, setStatuses] = useState({});

  const handleAdd = async (key) => {
    setStatuses((s) => ({ ...s, [key]: 'processing' }));
    try {
      // Demo fallback: simulate a successful saved-card charge.
      const run = onCharge || ((k) => new Promise((res) => setTimeout(() => res({ status: 'paid' }), 1400)));
      const result = await run(key);
      const next = result?.status === 'paid' ? 'done'
        : result?.status === 'needs_action' ? 'needs_action'
        : 'error';
      setStatuses((s) => ({ ...s, [key]: next }));
    } catch {
      setStatuses((s) => ({ ...s, [key]: 'error' }));
    }
  };

  return (
    <div style={{ maxWidth: 460, margin: '0 auto' }}>
      <style>{SPIN_CSS}</style>

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
          <UpsellCard key={item.key} item={item} status={statuses[item.key]} onAdd={handleAdd} />
        ))}
      </div>

      <p style={{ margin: '16px 0 0', textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.32)', lineHeight: 1.5 }}>
        🔒 Pago seguro · revisado a mano antes de enviártelo · garantía de calidad
      </p>
    </div>
  );
}

// ── Local demo (route /upsell-demo) — preview without a real order or Stripe ──
export default function OneTapUpsellDemo() {
  return (
    <div style={{ background: '#0c0810', minHeight: '100vh', padding: '28px 16px 80px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 460, margin: '0 auto 22px', textAlign: 'center', color: '#fff' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(95,207,138,0.12)', color: '#7fd99f', fontSize: 11.5, fontWeight: 600, padding: '5px 13px', borderRadius: 50 }}>
          ✓ Pago confirmado
        </span>
        <h1 style={{ margin: '12px 0 2px', fontSize: 23, fontWeight: 800 }}>
          La canción de <span style={{ color: PINK }}>María</span> ya está lista
        </h1>
        <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>Descárgala, compártela — y si quieres, hazla aún más especial</p>
      </div>
      <OneTapUpsell recipientName="María" last4="4242" />
    </div>
  );
}
