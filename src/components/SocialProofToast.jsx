import React, { useState, useEffect } from 'react';

// ═══════════════════════════════════════
// SOCIAL PROOF TOAST — Bottom-left popup
// ═══════════════════════════════════════

const NAMES = [
  'María', 'Carlos', 'Ana', 'José', 'Laura', 'Roberto', 'Daniela', 'Miguel',
  'Rosa', 'Fernando', 'Gabriela', 'Alejandro', 'Patricia', 'Ricardo', 'Sofía',
  'Eduardo', 'Carmen', 'Luis', 'Valentina', 'Diego', 'Isabella', 'Andrés',
  'Lucía', 'Javier', 'Camila', 'Ramón', 'Elena', 'Sergio', 'Adriana', 'Óscar',
];

const CITIES = [
  'Los Ángeles', 'Houston', 'Chicago', 'San Antonio', 'Dallas', 'Phoenix',
  'El Paso', 'San Diego', 'Denver', 'Las Vegas', 'Miami', 'Austin',
  'Sacramento', 'Tucson', 'Fresno', 'Albuquerque', 'San José', 'Bakersfield',
  'Oakland', 'Riverside', 'Stockton', 'Laredo', 'McAllen', 'Brownsville',
];

const GENRES = [
  'una romántica 💕', 'un corrido 🎵', 'una bachata 💃', 'una cumbia 🎶',
  'una banda 🎺', 'una balada ❤️', '2 canciones 🎁', 'un mariachi 🇲🇽',
];

const TIMES = [
  'hace 1 min', 'hace 2 min', 'hace 3 min', 'hace 5 min',
  'hace 7 min', 'hace 8 min', 'hace 12 min', 'hace 15 min',
];

function generateMessage() {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const genre = GENRES[Math.floor(Math.random() * GENRES.length)];
  const time = TIMES[Math.floor(Math.random() * TIMES.length)];
  return { name, city, genre, time };
}

export default function SocialProofToast() {
  const [visible, setVisible] = useState(false);
  const [msg, setMsg] = useState(generateMessage);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth <= 768);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    // First toast after 8 seconds
    let showTimeout, hideTimeout, intervalId;

    const showToast = () => {
      setMsg(generateMessage());
      setVisible(true);
      hideTimeout = setTimeout(() => setVisible(false), 4000);
    };

    // Initial delay
    showTimeout = setTimeout(() => {
      showToast();
      // Then every 12-18 seconds
      intervalId = setInterval(showToast, 12000 + Math.random() * 6000);
    }, 8000);

    return () => {
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
      clearInterval(intervalId);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 9999,
        pointerEvents: 'none',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        opacity: visible ? 1 : 0,
        // Mobile: top center, slide down. Desktop: bottom left, slide up.
        bottom: isMobile ? 'auto' : 24,
        top: isMobile ? 56 : 'auto',
        left: isMobile ? '50%' : 24,
        transform: visible
          ? isMobile ? 'translateX(-50%) translateY(0)' : 'translateY(0) scale(1)'
          : isMobile ? 'translateX(-50%) translateY(-20px)' : 'translateY(20px) scale(0.95)',
      }}
    >
      <div
        style={{
          background: 'rgba(38, 39, 86, 0.95)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 12px 40px rgba(10,10,32,0.55), 0 0 0 1px rgba(232,180,74,0.18)',
          maxWidth: 340,
          minWidth: 280,
        }}
      >
        {/* Emoji avatar */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #E4795A, #E8B44A)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          🎵
        </div>

        {/* Message */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            {msg.name} de {msg.city}
          </p>
          <p
            style={{
              color: 'rgba(255,255,255,0.68)',
              fontSize: 12,
              margin: '2px 0 0',
              lineHeight: 1.3,
            }}
          >
            compró {msg.genre}
          </p>
          <p
            style={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: 11,
              margin: '3px 0 0',
            }}
          >
            {msg.time} · Verificado ✓
          </p>
        </div>
      </div>
    </div>
  );
}
