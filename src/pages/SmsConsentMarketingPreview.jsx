import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';

export default function SmsConsentMarketingPreview() {
  const [phone, setPhone] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handlePagar = () => {
    setSubmitted(true);
  };

  const cleanPhone = phone.replace(/\D/g, '');
  const willOptIn = cleanPhone.length >= 10 && smsConsent;

  return (
    <div style={{
      background: '#0f0b0e',
      color: 'white',
      minHeight: '100vh',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    }}>
      <Helmet>
        <title>Checkout — Regalos Que Cantan</title>
        <meta name="description" content="Vista previa del checkout de Regalos Que Cantan. Reproducción exacta de la superficie de consentimiento SMS para revisión de cumplimiento." />
      </Helmet>

      {/* Compliance review banner */}
      <div style={{
        background: 'linear-gradient(90deg, #1e3a8a, #312e81)',
        color: 'rgba(255,255,255,0.95)',
        padding: '12px 16px',
        fontSize: '13px',
        textAlign: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        lineHeight: 1.5
      }}>
        <strong>Checkout preview for SMS promotional + transactional consent compliance review.</strong> Customers see this exact opt-in surface when completing their purchase on regalosquecantan.com. SMS opt-in is captured via a dedicated, unchecked-by-default consent checkbox shown below the phone field — clicking "Pagar" alone does not opt the customer into SMS, and consent to receive promotional messages is not required to make a purchase. Production customers are Spanish-speaking; English translations are shown in parentheses for reviewer convenience. The SMS consent checkbox label is in English exactly as shown to U.S. customers.
      </div>

      {/* Brand header */}
      <header style={{
        background: 'rgba(15,11,14,0.92)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            src="/images/logo-small.png"
            alt="RegalosQueCantan"
            style={{ height: '36px', width: '36px', objectFit: 'contain' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <span style={{ fontSize: '17px', fontWeight: 600, letterSpacing: '-0.01em' }}>
            RegalosQueCantan
          </span>
        </div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
          🔒 Pago seguro <span style={{ color: 'rgba(255,255,255,0.35)' }}>(Secure payment)</span>
        </div>
      </header>

      <main style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px 80px' }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: 700,
          margin: '0 0 6px',
          letterSpacing: '-0.01em'
        }}>
          Confirmar tu pedido <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '16px', fontWeight: 500 }}>(Confirm your order)</span>
        </h1>
        <p style={{
          color: 'rgba(255,255,255,0.55)',
          fontSize: '14px',
          margin: '0 0 24px'
        }}>
          Falta solo un paso para recibir tu canción personalizada. <em style={{ color: 'rgba(255,255,255,0.4)' }}>(One last step to receive your personalized song.)</em>
        </p>

        {/* Order summary */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '14px',
          padding: '16px',
          marginBottom: '28px',
          display: 'flex',
          gap: '14px',
          alignItems: 'center'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '10px',
            overflow: 'hidden',
            flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(225,29,116,0.25), rgba(168,85,247,0.2))'
          }}>
            <img
              src="/images/album-art/cumbia.jpg"
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
              Tu Canción Personalizada <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>(Your Personalized Song)</span>
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.55)' }}>
              Cumbia Romántica · Versión 1 <span style={{ color: 'rgba(255,255,255,0.35)' }}>(Romantic Cumbia · Version 1)</span>
            </p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f74da6' }}>
              $29.99
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
              USD
            </p>
          </div>
        </div>

        {/* Email field (mock — read-only context) */}
        <div style={{ marginBottom: '22px' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            color: 'rgba(255,255,255,0.95)',
            fontSize: '14px',
            fontWeight: 600
          }}>
            Correo electrónico <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>(Email)</span>
          </label>
          <input
            type="email"
            placeholder="tu@correo.com"
            disabled
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '13px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1.5px solid rgba(255,255,255,0.12)',
              borderRadius: '10px',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '15px',
              outline: 'none'
            }}
          />
        </div>

        {/* SMS opt-in section — the surface being reviewed */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          padding: '18px',
          marginBottom: '24px'
        }}>
          <label
            htmlFor="sms-consent-phone"
            style={{
              display: 'block',
              marginBottom: '8px',
              color: 'rgba(255,255,255,0.95)',
              fontSize: '15px',
              fontWeight: 600
            }}
          >
            Phone number (optional) — for SMS order updates &amp; offers
          </label>
          <input
            id="sms-consent-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d\s\-\+\(\)]/g, ''))}
            placeholder="Tu número de teléfono"
            maxLength={20}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '13px 16px',
              background: 'rgba(255,255,255,0.08)',
              border: '1.5px solid rgba(255,255,255,0.15)',
              borderRadius: '10px',
              color: 'white',
              fontSize: '15px',
              outline: 'none'
            }}
          />

          {/* SMS consent checkbox — unchecked by default, optional, dedicated to SMS only */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            marginTop: '16px',
            padding: '14px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px'
          }}>
            <input
              id="sms-consent-checkbox"
              type="checkbox"
              checked={smsConsent}
              onChange={(e) => setSmsConsent(e.target.checked)}
              style={{
                marginTop: '3px',
                width: '18px',
                height: '18px',
                flexShrink: 0,
                accentColor: '#f74da6',
                cursor: 'pointer'
              }}
            />
            <label
              htmlFor="sms-consent-checkbox"
              style={{
                color: 'rgba(255,255,255,0.85)',
                fontSize: '13px',
                lineHeight: 1.6,
                cursor: 'pointer'
              }}
            >
              I agree to receive automated promotional and transactional text messages (SMS) from Regalos Que Cantan — order confirmations, song-ready delivery links, delivery status, customer-care responses, and occasional offers and discounts. Message frequency varies (up to a few per month). Message and data rates may apply. Reply STOP to cancel or HELP for help. Consent to receive promotional messages is not required to make a purchase. See our Privacy Policy (<a href="/politica-de-privacidad" target="_blank" rel="noopener noreferrer" style={{ color: '#f74da6', textDecoration: 'underline' }}>regalosquecantan.com/politica-de-privacidad</a>) and Terms of Service (<a href="/terminos-de-servicio" target="_blank" rel="noopener noreferrer" style={{ color: '#f74da6', textDecoration: 'underline' }}>regalosquecantan.com/terminos-de-servicio</a>).
            </label>
          </div>

          <p style={{
            margin: '10px 0 0',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '12px',
            lineHeight: 1.5,
            fontStyle: 'italic'
          }}>
            The checkbox above is unchecked by default and is not required to complete checkout — consent to promotional messages is not a condition of purchase. The phone field is also optional. SMS opt-in is recorded server-side only when both the phone field is filled <em>and</em> the checkbox is checked at submit, together with a timestamp for audit purposes.
          </p>
        </div>

        {/* Pagar button */}
        <button
          type="button"
          onClick={handlePagar}
          style={{
            width: '100%',
            padding: '18px',
            background: 'linear-gradient(90deg, #e11d74, #c026d3)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(225,29,116,0.4)'
          }}
        >
          Pagar $29.99 — Pay $29.99
        </button>

        {submitted && (
          <div style={{
            marginTop: '18px',
            padding: '14px 16px',
            background: 'rgba(34,197,94,0.12)',
            border: '1px solid rgba(34,197,94,0.35)',
            borderRadius: '10px',
            color: '#86efac',
            fontSize: '13px',
            lineHeight: 1.5
          }}>
            <strong>Preview / Vista previa</strong> — In the live checkout, clicking "Pagar" securely processes payment via Stripe. SMS opt-in is recorded server-side <strong>only when</strong> the customer has both (a) entered a phone number and (b) actively checked the dedicated SMS consent checkbox above. Submitting without checking the box completes the purchase but does <strong>not</strong> opt the customer into SMS.<br /><br />
            <strong>Captured state for this preview submission:</strong> phone {cleanPhone.length >= 10 ? '✓ provided' : '✗ not provided'} · SMS consent checkbox {smsConsent ? '✓ checked' : '✗ unchecked'} → <strong>{willOptIn ? 'Customer WOULD be opted into SMS' : 'Customer would NOT be opted into SMS'}</strong>.<br /><br />
            <em style={{ color: 'rgba(134,239,172,0.7)' }}>This page is a reproduction of the production checkout for compliance verification only; no payment is processed and no SMS opt-in is recorded here. (En el checkout real, este botón procesa el pago de forma segura a través de Stripe.)</em>
          </div>
        )}

        <p style={{
          marginTop: '24px',
          textAlign: 'center',
          fontSize: '12px',
          color: 'rgba(255,255,255,0.4)',
          lineHeight: 1.6
        }}>
          Pago seguro procesado por Stripe · Garantía de satisfacción<br />
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>(Secure payment processed by Stripe · Satisfaction guarantee)</span><br />
          ¿Preguntas? <span style={{ color: 'rgba(255,255,255,0.3)' }}>(Questions?)</span> <a href="mailto:hola@regalosquecantan.com" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'underline' }}>hola@regalosquecantan.com</a>
        </p>
      </main>
    </div>
  );
}
