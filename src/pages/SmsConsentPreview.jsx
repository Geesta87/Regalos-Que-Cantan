import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';

export default function SmsConsentPreview() {
  const [phone, setPhone] = useState('');

  return (
    <div style={{
      background: '#0f0b0e',
      color: 'white',
      minHeight: '100vh',
      padding: '60px 20px',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    }}>
      <Helmet>
        <title>SMS Consent — Regalos Que Cantan</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^\d\s\-\+\(\)]/g, ''))}
          placeholder="Tu número de teléfono"
          maxLength={20}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.08)',
            border: '1.5px solid rgba(255,255,255,0.15)',
            borderRadius: '10px',
            color: 'white',
            fontSize: '16px',
            outline: 'none'
          }}
        />

        <p style={{
          margin: '14px 0 22px',
          color: 'rgba(255,255,255,0.85)',
          fontSize: '14px',
          lineHeight: 1.6
        }}>
          By providing your phone number, you agree to receive transactional text messages about your order from Regalos Que Cantan. Message frequency varies. Message and data rates may apply. Reply STOP to cancel or HELP for help. See our Privacy Policy (<a href="/politica-de-privacidad" target="_blank" rel="noopener noreferrer" style={{ color: '#e11d74', textDecoration: 'underline' }}>regalosquecantan.com/politica-de-privacidad</a>) and Terms of Service (<a href="/terminos-de-servicio" target="_blank" rel="noopener noreferrer" style={{ color: '#e11d74', textDecoration: 'underline' }}>regalosquecantan.com/terminos-de-servicio</a>).
        </p>

        <button
          type="button"
          onClick={() => {}}
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
          Pagar
        </button>
      </div>
    </div>
  );
}
