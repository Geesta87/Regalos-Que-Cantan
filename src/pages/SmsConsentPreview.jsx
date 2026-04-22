import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';

export default function SmsConsentPreview() {
  const [whatsappPhone, setWhatsappPhone] = useState('');

  return (
    <div style={{ background: '#0f0b0e', color: 'white', minHeight: '100vh', padding: '40px 20px 80px' }}>
      <Helmet>
        <title>SMS Consent Preview — Regalos Que Cantan</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Reviewer-facing explainer */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: '20px 22px',
          marginBottom: 24,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          lineHeight: 1.55,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: '#a855f7', textTransform: 'uppercase' }}>
            For Twilio A2P 10DLC Reviewers
          </p>
          <h1 style={{ margin: '8px 0 12px', fontSize: 22, fontWeight: 800, color: 'white' }}>
            SMS Consent Surface — Preview
          </h1>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
            This page reproduces the exact phone-number collection field and SMS disclosure that end-users see during checkout on Regalos Que Cantan. It is provided as a stable URL so reviewers can inspect the opt-in surface without completing the full song-creation flow.
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
            In production, this identical block is rendered on <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4, fontSize: 13 }}>https://regalosquecantan.com/comparison</code>, directly above the "Pagar" (Pay) button, after a customer has generated a personalized song. The phone field is optional; customers can complete checkout without providing a number.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
            This preview page is not linked from anywhere on the public site and is excluded from search indexing.
          </p>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            BEGIN: Verbatim copy of the phone-input section from
            src/pages/ComparisonPage.jsx (Section 5). Keep visually
            identical to the real checkout surface.
            ═══════════════════════════════════════════════════════════ */}
        <div style={{
          background: 'rgba(37,211,102,0.06)', border: '1px solid rgba(37,211,102,0.2)',
          borderRadius: '14px', padding: '14px 16px', marginBottom: '16px',
          animation: 'fadeIn 0.6s ease-out 0.15s both'
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px'}}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '6px',
              background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <p style={{margin: 0, fontSize: '14px', fontWeight: '600', color: 'white', flex: 1}}>
              Recibe por WhatsApp y Número de Teléfono
            </p>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <input
              type="tel"
              value={whatsappPhone}
              onChange={(e) => { setWhatsappPhone(e.target.value.replace(/[^\d\s\-\+\(\)]/g, '')); }}
              placeholder="Tu número de teléfono"
              maxLength={20}
              style={{
                flex: 1, padding: '12px 14px',
                background: 'rgba(255,255,255,0.08)', border: whatsappPhone.replace(/\D/g, '').length >= 10 ? '1.5px solid #25D366' : '1.5px solid rgba(255,255,255,0.1)',
                borderRadius: '10px', color: 'white', fontSize: '15px', outline: 'none', transition: 'border-color 0.3s'
              }}
            />
            {whatsappPhone.replace(/\D/g, '').length >= 10 && (
              <div style={{width: '32px', height: '32px', borderRadius: '50%', background: '#25D366',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
                <span style={{color: 'white', fontSize: '16px', fontWeight: 'bold'}}>✓</span>
              </div>
            )}
          </div>
          <p style={{margin: '8px 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '12px', lineHeight: 1.6}}>
            By providing your phone number, you agree to receive transactional text messages about your order from Regalos Que Cantan. Message and data rates may apply. Reply STOP to cancel. See our <a href="/politica-de-privacidad" target="_blank" rel="noopener noreferrer" style={{color: '#25D366', textDecoration: 'underline'}}>Privacy Policy</a> and <a href="/terminos-de-servicio" target="_blank" rel="noopener noreferrer" style={{color: '#25D366', textDecoration: 'underline'}}>Terms of Service</a>.
          </p>
        </div>
        {/* ═══════════════════════════════════════════════════════════ END ═══ */}

        {/* Reviewer-facing footer notes */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          padding: '16px 18px',
          marginTop: 24,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          fontSize: 13,
          lineHeight: 1.6,
          color: 'rgba(255,255,255,0.7)'
        }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>Consent mechanics:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>The phone field is optional; checkout completes without it and delivery falls back to email.</li>
            <li>The field is never pre-filled, and no checkbox is pre-checked.</li>
            <li>The disclosure text above is visible before the customer submits anything.</li>
            <li>Clicking "Pagar" on the real page is the single action that records consent and places the order.</li>
            <li>Only transactional order messages are sent (confirmation, "song ready" link, delivery updates).</li>
            <li>Replying <strong>STOP</strong> unsubscribes the number immediately; <strong>HELP</strong> returns contact info.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
