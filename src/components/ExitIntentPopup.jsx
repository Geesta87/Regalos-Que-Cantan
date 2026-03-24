import React, { useState, useEffect, useRef, useCallback } from 'react';
import { validateCoupon } from '../services/api';

const COUPON_CODE = 'VUELVE15';
const DISCOUNT_PERCENT = 15;
const SESSION_KEY = 'rqc_exit_intent_shown';
const ARM_DELAY_MS = 5000;
const MOBILE_INACTIVITY_MS = 45000;
const COUNTDOWN_SECONDS = 15 * 60; // 15 minutes

export default function ExitIntentPopup({ onApplyCoupon, onClose, couponApplied, selectedSongs = [], purchaseBoth = false }) {
  const [visible, setVisible] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);
  const [timeLeft, setTimeLeft] = useState(COUNTDOWN_SECONDS);
  const [isApplying, setIsApplying] = useState(false);
  const armed = useRef(false);
  const shown = useRef(false);
  const inactivityTimer = useRef(null);
  const countdownInterval = useRef(null);

  // Pricing calculation
  const singlePrice = 24.99;
  const bundlePrice = 39.99;
  const originalPrice = purchaseBoth ? bundlePrice : singlePrice;
  const discountedPrice = (originalPrice * (1 - DISCOUNT_PERCENT / 100)).toFixed(2);

  const showPopup = useCallback(() => {
    if (shown.current) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    if (couponApplied) return;

    shown.current = true;
    sessionStorage.setItem(SESSION_KEY, '1');
    setVisible(true);
    // Trigger animation after mount
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true));
    });
  }, [couponApplied]);

  // Arm the trigger after delay
  useEffect(() => {
    if (couponApplied) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const armTimer = setTimeout(() => {
      armed.current = true;
    }, ARM_DELAY_MS);

    return () => clearTimeout(armTimer);
  }, [couponApplied]);

  // Desktop: mouseleave toward top
  useEffect(() => {
    if (couponApplied) return;

    const handleMouseLeave = (e) => {
      if (!armed.current || shown.current) return;
      if (e.clientY < 10) {
        showPopup();
      }
    };

    document.addEventListener('mouseleave', handleMouseLeave);
    return () => document.removeEventListener('mouseleave', handleMouseLeave);
  }, [couponApplied, showPopup]);

  // Mobile: back button (popstate) + inactivity timer
  useEffect(() => {
    if (couponApplied) return;

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) return;

    // Push a state so we can detect back button
    window.history.pushState({ exitIntent: true }, '');

    const handlePopState = (e) => {
      if (!armed.current || shown.current) return;
      showPopup();
      // Re-push so the user doesn't actually navigate away
      window.history.pushState({ exitIntent: true }, '');
    };

    window.addEventListener('popstate', handlePopState);

    // Inactivity timer
    const resetInactivity = () => {
      clearTimeout(inactivityTimer.current);
      if (!armed.current || shown.current) return;
      inactivityTimer.current = setTimeout(() => {
        showPopup();
      }, MOBILE_INACTIVITY_MS);
    };

    resetInactivity();
    const events = ['touchstart', 'scroll', 'click'];
    events.forEach(evt => document.addEventListener(evt, resetInactivity, { passive: true }));

    return () => {
      window.removeEventListener('popstate', handlePopState);
      events.forEach(evt => document.removeEventListener(evt, resetInactivity));
      clearTimeout(inactivityTimer.current);
    };
  }, [couponApplied, showPopup]);

  // Countdown timer
  useEffect(() => {
    if (!visible) return;

    countdownInterval.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval.current);
  }, [visible]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const result = await validateCoupon(COUPON_CODE);
      if (result.valid) {
        onApplyCoupon(result);
      }
    } catch (err) {
      // Even if validation fails, still apply the code - create-checkout does its own validation
      onApplyCoupon({ valid: true, code: COUPON_CODE, type: 'percentage', discount: DISCOUNT_PERCENT, free: false });
    } finally {
      setIsApplying(false);
    }
  };

  const handleClose = () => {
    setAnimateIn(false);
    setTimeout(() => {
      setVisible(false);
      if (onClose) onClose();
    }, 300);
  };

  if (!visible) return null;

  const countdownProgress = timeLeft / COUNTDOWN_SECONDS;

  return (
    <>
      {/* Inline keyframes */}
      <style>{`
        @keyframes exitShimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes exitPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>

      {/* Overlay */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 9998,
          opacity: animateIn ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px',
          pointerEvents: 'none',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            pointerEvents: 'auto',
            width: '100%',
            maxWidth: '420px',
            background: 'linear-gradient(180deg, #1a1025 0%, #0f0a18 100%)',
            borderRadius: '20px',
            border: '1px solid rgba(225,29,116,0.3)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(225,29,116,0.15)',
            overflow: 'hidden',
            transform: animateIn ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.95)',
            opacity: animateIn ? 1 : 0,
            transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
          }}
        >
          {/* Urgency bar */}
          <div style={{
            background: 'linear-gradient(90deg, #e11d74, #c026d3)',
            padding: '8px 16px',
            textAlign: 'center',
            fontSize: '13px',
            fontWeight: 'bold',
            color: 'white',
            letterSpacing: '0.5px',
          }}>
            <span role="img" aria-label="clock">&#9200;</span> &#161;OFERTA POR TIEMPO LIMITADO!
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            style={{
              position: 'absolute',
              top: '44px',
              right: '12px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              fontSize: '18px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            &#10005;
          </button>

          {/* Content */}
          <div style={{ padding: '24px 24px 20px' }}>
            {/* Gift emoji */}
            <div style={{ textAlign: 'center', fontSize: '48px', marginBottom: '12px' }}>
              <span role="img" aria-label="gift">&#127873;</span>
            </div>

            {/* Title */}
            <h2 style={{
              textAlign: 'center',
              fontSize: '22px',
              fontWeight: 'bold',
              color: 'white',
              margin: '0 0 8px',
              lineHeight: 1.3,
            }}>
              &#161;Espera! Tu canci&oacute;n tiene un{' '}
              <span style={{
                background: 'linear-gradient(90deg, #e11d74, #c026d3)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                descuento especial
              </span>
            </h2>

            {/* Subtitle */}
            <p style={{
              textAlign: 'center',
              color: 'rgba(255,255,255,0.6)',
              fontSize: '14px',
              margin: '0 0 20px',
              lineHeight: 1.4,
            }}>
              Tu canci&oacute;n personalizada est&aacute; lista. Ll&eacute;vala ahora con precio exclusivo.
            </p>

            {/* Discount card */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(225,29,116,0.15), rgba(192,38,211,0.15))',
              border: '1px solid rgba(225,29,116,0.3)',
              borderRadius: '16px',
              padding: '20px',
              textAlign: 'center',
              marginBottom: '16px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* SOLO POR HOY badge */}
              <div style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'linear-gradient(90deg, #e11d74, #c026d3)',
                color: 'white',
                fontSize: '10px',
                fontWeight: 'bold',
                padding: '3px 10px',
                borderRadius: '20px',
                letterSpacing: '0.5px',
              }}>
                SOLO POR HOY
              </div>

              {/* Discount percentage */}
              <div style={{
                fontSize: '48px',
                fontWeight: '900',
                background: 'linear-gradient(90deg, #e11d74, #c026d3, #e11d74)',
                backgroundSize: '200% auto',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                animation: 'exitShimmer 3s linear infinite',
                lineHeight: 1,
                marginBottom: '4px',
              }}>
                {DISCOUNT_PERCENT}% OFF
              </div>

              {/* Price comparison */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '8px' }}>
                <span style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: '20px',
                  textDecoration: 'line-through',
                }}>
                  ${originalPrice.toFixed(2)}
                </span>
                <span style={{
                  color: '#4ade80',
                  fontSize: '28px',
                  fontWeight: 'bold',
                }}>
                  ${discountedPrice}
                </span>
              </div>
            </div>

            {/* Coupon code display */}
            <div style={{
              border: '2px dashed rgba(225,29,116,0.5)',
              borderRadius: '12px',
              padding: '12px',
              textAlign: 'center',
              marginBottom: '16px',
              background: 'rgba(225,29,116,0.05)',
            }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', display: 'block', marginBottom: '4px' }}>
                Tu c&oacute;digo de descuento:
              </span>
              <span style={{
                color: 'white',
                fontSize: '24px',
                fontWeight: 'bold',
                letterSpacing: '3px',
                fontFamily: 'monospace',
              }}>
                {COUPON_CODE}
              </span>
            </div>

            {/* CTA Button */}
            <button
              onClick={handleApply}
              disabled={isApplying}
              style={{
                width: '100%',
                padding: '16px',
                background: 'linear-gradient(90deg, #e11d74, #c026d3)',
                color: 'white',
                border: 'none',
                borderRadius: '14px',
                fontSize: '18px',
                fontWeight: 'bold',
                cursor: isApplying ? 'wait' : 'pointer',
                boxShadow: '0 4px 25px rgba(225,29,116,0.5)',
                transition: 'transform 0.2s, box-shadow 0.2s',
                animation: isApplying ? 'none' : 'exitPulse 2s ease-in-out infinite',
              }}
              onMouseEnter={(e) => { if (!isApplying) { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 6px 30px rgba(225,29,116,0.6)'; }}}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 25px rgba(225,29,116,0.5)'; }}
            >
              {isApplying ? (
                <span>Aplicando...</span>
              ) : (
                <span><span role="img" aria-label="music">&#127925;</span> Aplicar descuento y comprar</span>
              )}
            </button>

            {/* Skip link */}
            <button
              onClick={handleClose}
              style={{
                display: 'block',
                width: '100%',
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                fontSize: '13px',
                marginTop: '12px',
                cursor: 'pointer',
                padding: '8px',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
              }}
            >
              No gracias, quiero pagar precio completo
            </button>

            {/* Countdown timer */}
            <div style={{ marginTop: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginBottom: '8px',
              }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>Oferta expira en:</span>
                <span style={{
                  color: timeLeft < 60 ? '#ef4444' : '#fbbf24',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                }}>
                  {formatTime(timeLeft)}
                </span>
              </div>
              {/* Progress bar */}
              <div style={{
                width: '100%',
                height: '4px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '2px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${countdownProgress * 100}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #e11d74, #c026d3)',
                  borderRadius: '2px',
                  transition: 'width 1s linear',
                }} />
              </div>
            </div>

            {/* Social proof */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '16px',
            }}>
              {/* Avatar circles */}
              <div style={{ display: 'flex' }}>
                {['#e11d74', '#c026d3', '#8b5cf6', '#3b82f6'].map((color, i) => (
                  <div
                    key={i}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: color,
                      border: '2px solid #1a1025',
                      marginLeft: i > 0 ? '-8px' : '0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                    }}
                  >
                    {['M', 'A', 'L', 'R'][i]}
                  </div>
                ))}
              </div>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>
                23 personas compraron hoy
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
