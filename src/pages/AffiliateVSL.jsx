import React, { useContext, useMemo, useState } from 'react';
import { AppContext } from '../App';

export default function AffiliateVSL() {
  const { navigateTo } = useContext(AppContext);
  const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const phoneNumber = '8183065193';
  const whatsappLink = `https://wa.me/1${phoneNumber}?text=Hola%20Gerardo%2C%20vi%20tu%20video%20y%20quiero%20saber%20mas%20sobre%20el%20programa%20de%20partners`;

  // Schedule-a-call state — bookable window: tomorrow through +21 days, weekdays only
  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const minDay = useMemo(() => { const d = new Date(todayStart); d.setDate(d.getDate() + 1); return d; }, [todayStart]);
  const maxDay = useMemo(() => { const d = new Date(todayStart); d.setDate(d.getDate() + 21); return d; }, [todayStart]);
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);

  const monthCells = useMemo(() => {
    const cells = [];
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first grid
    for (let i = 0; i < offset; i++) cells.push(null);
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
    return cells;
  }, [viewMonth]);

  const canPrevMonth = viewMonth.getTime() > new Date(todayStart.getFullYear(), todayStart.getMonth(), 1).getTime();
  const canNextMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1).getTime() <= maxDay.getTime();
  const isSelectable = (d) => !!d && d >= minDay && d <= maxDay && d.getDay() !== 0 && d.getDay() !== 6;
  const isSameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const callTimes = ['10:00 AM', '11:00 AM', '12:00 PM', '2:00 PM', '4:00 PM', '5:00 PM', '6:00 PM'];

  const selectedDateLabel = selectedDate
    ? selectedDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
    : null;
  const ready = !!(selectedDate && selectedTime);

  // Booking form (saved to partner_call_bookings via book-partner-call, then
  // opens WhatsApp with the request so the owner gets it both ways)
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [formError, setFormError] = useState('');
  const [booked, setBooked] = useState(false);

  const buildWaLink = () => {
    const msg = `Hola Gerardo, soy ${leadName.trim()}. Quiero agendar la llamada sin compromiso para conocer el programa de partners. Me funciona el ${selectedDateLabel} a las ${selectedTime}. ¿Te queda bien?`;
    return `https://wa.me/1${phoneNumber}?text=${encodeURIComponent(msg)}`;
  };

  const submitBooking = () => {
    if (!ready) return;
    const digits = leadPhone.replace(/\D/g, '');
    if (leadName.trim().length < 2) { setFormError('Escribe tu nombre'); return; }
    if (digits.length < 10) { setFormError('Escribe tu número de WhatsApp (10 dígitos)'); return; }
    setFormError('');
    const yyyy = selectedDate.getFullYear();
    const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const dd = String(selectedDate.getDate()).padStart(2, '0');
    // Fire-and-forget so the WhatsApp tab opens synchronously (popup blockers);
    // the booking lands in the admin dashboard either way.
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/book-partner-call`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ name: leadName.trim(), phone: digits, date: `${yyyy}-${mm}-${dd}`, time: selectedTime }),
    }).catch(() => {});
    window.open(buildWaLink(), '_blank', 'noopener,noreferrer');
    setBooked(true);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer-bar {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes pulse-soft {
          0%, 100% { box-shadow: 0 0 0 0 rgba(225,29,72,0.3); }
          50% { box-shadow: 0 0 0 14px rgba(225,29,72,0); }
        }

        .vsl-contact-btn {
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }
        .vsl-contact-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(0,0,0,0.12) !important;
        }

        /* --- Schedule-a-call calendar --- */
        .vsl-cal-day {
          aspect-ratio: 1;
          width: 100%;
          border-radius: 12px;
          border: 1.5px solid transparent;
          background: transparent;
          font-family: inherit;
          font-size: 13.5px;
          font-weight: 600;
          color: #1c1917;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        .vsl-cal-day:hover:not(:disabled):not(.vsl-cal-selected) {
          background: #fff1f2;
          border-color: #fecdd3;
        }
        .vsl-cal-day:disabled {
          color: #d6d3d1;
          cursor: default;
          font-weight: 500;
        }
        .vsl-cal-selected {
          background: linear-gradient(135deg, #e11d48, #f43f5e) !important;
          color: #fff !important;
          box-shadow: 0 6px 16px rgba(225,29,72,0.35);
        }
        .vsl-cal-nav {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          border: 1px solid #fde8d4;
          background: #fff;
          color: #1c1917;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
          padding: 0;
        }
        .vsl-cal-nav:hover:not(:disabled) { background: #fff1f2; border-color: #fecdd3; }
        .vsl-cal-nav:disabled { opacity: 0.3; cursor: default; }
        .vsl-time-pill {
          padding: 12px 8px;
          border-radius: 12px;
          border: 1.5px solid #fde8d4;
          background: #fff;
          font-family: inherit;
          font-size: 13px;
          font-weight: 700;
          color: #1c1917;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .vsl-time-pill:hover:not(:disabled):not(.vsl-time-selected) {
          background: #fff1f2;
          border-color: #fecdd3;
        }
        .vsl-time-pill:disabled { opacity: 0.45; cursor: default; }
        .vsl-time-selected {
          background: linear-gradient(135deg, #e11d48, #f43f5e) !important;
          color: #fff !important;
          border-color: transparent !important;
          box-shadow: 0 6px 16px rgba(225,29,72,0.35);
        }
        .vsl-input {
          display: block;
          width: 100%;
          margin-top: 6px;
          padding: 13px 14px;
          border-radius: 12px;
          border: 1.5px solid #fde8d4;
          background: #fff;
          font-family: inherit;
          font-size: 15px;
          font-weight: 600;
          color: #1c1917;
          outline: none;
          transition: border-color 0.15s ease;
          letter-spacing: normal;
          text-transform: none;
        }
        .vsl-input:focus { border-color: #e11d48; }
        .vsl-input::placeholder { color: #d6d3d1; font-weight: 500; }

        @media (max-width: 640px) {
          .vsl-hero-title { font-size: 1.6rem !important; }
          .vsl-contact-grid { grid-template-columns: 1fr !important; }
          .vsl-section { padding: 24px 16px 60px !important; }
          .vsl-contact-btn { padding: 18px 16px !important; }
          .vsl-phone-display { font-size: 22px !important; }
          .vsl-rewards-card { padding: 18px 14px !important; }
          .vsl-selling-card { padding: 14px !important; gap: 12px !important; }
          .vsl-selling-icon { width: 40px !important; height: 40px !important; font-size: 20px !important; }
          .vsl-selling-title { font-size: 14px !important; }
          .vsl-selling-desc { font-size: 12.5px !important; }
          .vsl-reward-row { padding: 10px 12px !important; }
          .vsl-reward-title { font-size: 12.5px !important; white-space: normal !important; }
          .vsl-reward-amount { font-size: 14px !important; }
          .vsl-rewards-total { font-size: 20px !important; }
          .vsl-heading { font-size: 19px !important; }
          .vsl-subheading { font-size: 18px !important; }
          .vsl-schedule-card { padding: 18px 14px !important; }
          .vsl-sched-body { grid-template-columns: 1fr !important; }
          .vsl-time-grid { grid-template-columns: repeat(3, 1fr) !important; }
          .vsl-lead-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 380px) {
          .vsl-section { padding: 20px 14px 50px !important; }
          .vsl-contact-grid { gap: 10px !important; }
          .vsl-phone-label { font-size: 10px !important; }
          .vsl-phone-value { font-size: 13px !important; }
        }
      `}</style>

      <div style={{ background: '#fffaf5', color: '#1c1917', fontFamily: font, minHeight: '100vh' }}>
        {/* Top gradient bar */}
        <div style={{ height: '3px', background: 'linear-gradient(90deg, #e11d48, #7c3aed, #3b82f6, #e11d48)', backgroundSize: '200% 100%', animation: 'shimmer-bar 3s linear infinite', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100 }} />

        {/* Minimal nav */}
        <nav style={{ padding: '18px 24px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ fontFamily: font, fontSize: '18px', fontWeight: 800, color: '#1c1917' }}>
            Regalos<span style={{ color: '#e11d48' }}>QueCantan</span>
          </span>
        </nav>

        {/* ============ MAIN CONTENT ============ */}
        <section className="vsl-section" style={{ maxWidth: '680px', margin: '0 auto', padding: '30px 24px 80px' }}>
          {/* Personal greeting */}
          <div style={{ textAlign: 'center', marginBottom: '28px', animation: 'fadeUp 0.6s ease-out' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'linear-gradient(135deg, #f97316, #e11d48)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '18px', fontFamily: font, boxShadow: '0 6px 20px rgba(249,115,22,0.3)' }}>
                G
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>Mensaje de</p>
                <p style={{ fontSize: '15px', color: '#1c1917', fontWeight: 700, margin: 0 }}>Gerardo — Fundador</p>
              </div>
            </div>

            <h1 className="vsl-hero-title" style={{
              fontFamily: font, fontSize: 'clamp(1.6rem, 4.5vw, 2.2rem)',
              fontWeight: 800, lineHeight: 1.25, marginBottom: '12px',
              color: '#1c1917', letterSpacing: '-0.02em',
            }}>
              Mira este video 👇
            </h1>
            <p style={{ fontSize: '15px', color: '#78716c', lineHeight: 1.6 }}>
              Te explico todo en 5 minutos
            </p>
          </div>

          {/* ============ VIDEO ============ */}
          <div style={{
            position: 'relative', borderRadius: '24px', overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(225,110,73,0.15), 0 4px 12px rgba(0,0,0,0.06)',
            border: '1px solid #fde8d4',
            aspectRatio: '16/9',
            background: '#1c1917',
            marginBottom: '40px',
            animation: 'fadeUp 0.8s ease-out 0.1s both',
          }}>
            <iframe
              src="https://www.youtube.com/embed/MK8XSTK_a_0?rel=0&modestbranding=1&start=3&playsinline=1"
              title="Mensaje personal de Gerardo"
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>

          {/* ============ CONTACT SECTION ============ */}
          <div style={{ textAlign: 'center', animation: 'fadeUp 0.8s ease-out 0.2s both' }}>
            <h2 className="vsl-heading" style={{ fontFamily: font, fontSize: '22px', fontWeight: 800, color: '#1c1917', marginBottom: '8px', letterSpacing: '-0.01em' }}>
              ¿Te interesa? Contáctame directamente
            </h2>
            <p style={{ fontSize: '14px', color: '#78716c', marginBottom: '28px' }}>
              Escríbenos por WhatsApp o llámanos. Te contestamos personalmente.
            </p>

            {/* Contact buttons */}
            <div className="vsl-contact-grid" style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '14px',
              marginBottom: '28px',
            }}>
              {/* WhatsApp */}
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="vsl-contact-btn"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                  background: 'linear-gradient(135deg, #25d366, #128c7e)',
                  color: '#fff',
                  padding: '22px 20px',
                  borderRadius: '18px',
                  textDecoration: 'none',
                  fontWeight: 700, fontSize: '16px', fontFamily: font,
                  boxShadow: '0 8px 24px rgba(37,211,102,0.25)',
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                <div style={{ textAlign: 'left' }}>
                  <div className="vsl-phone-label" style={{ fontSize: '11px', opacity: 0.9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>WhatsApp</div>
                  <div className="vsl-phone-value" style={{ fontSize: '15px', fontWeight: 700 }}>Enviar mensaje</div>
                </div>
              </a>

              {/* Phone */}
              <a
                href={`tel:+1${phoneNumber}`}
                className="vsl-contact-btn"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                  background: 'linear-gradient(135deg, #e11d48, #f43f5e)',
                  color: '#fff',
                  padding: '22px 20px',
                  borderRadius: '18px',
                  textDecoration: 'none',
                  fontWeight: 700, fontSize: '16px', fontFamily: font,
                  boxShadow: '0 8px 24px rgba(225,29,72,0.25)',
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
                <div style={{ textAlign: 'left' }}>
                  <div className="vsl-phone-label" style={{ fontSize: '11px', opacity: 0.9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Llámame</div>
                  <div className="vsl-phone-value" style={{ fontSize: '15px', fontWeight: 700 }}>(213) 666-6619</div>
                </div>
              </a>
            </div>

            {/* Direct phone number display */}
            <div style={{
              background: '#fff',
              borderRadius: '16px',
              padding: '20px',
              border: '1px dashed #fde8d4',
              marginBottom: '36px',
            }}>
              <p style={{ fontSize: '12px', color: '#a8a29e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                📞 Mi número directo
              </p>
              <a href={`tel:+1${phoneNumber}`} className="vsl-phone-display" style={{ fontFamily: font, fontSize: '26px', fontWeight: 800, color: '#1c1917', textDecoration: 'none', letterSpacing: '-0.5px' }}>
                (213) 666-6619
              </a>
              <p style={{ fontSize: '13px', color: '#78716c', marginTop: '6px' }}>
                Disponible de lunes a viernes
              </p>
            </div>

            {/* ============ SCHEDULE A CALL ============ */}
            <div className="vsl-schedule-card" style={{
              background: '#fff',
              borderRadius: '20px',
              padding: '24px',
              border: '1px solid #fde8d4',
              boxShadow: '0 4px 24px rgba(225,110,73,0.06)',
              marginBottom: '36px',
              textAlign: 'center',
            }}>
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '999px', padding: '6px 14px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px' }}>🤝</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#e11d48', letterSpacing: '0.3px' }}>15 minutos · Cero compromiso</span>
                </div>
                <h3 className="vsl-subheading" style={{ fontFamily: font, fontSize: '20px', fontWeight: 800, color: '#1c1917', marginBottom: '6px', letterSpacing: '-0.01em' }}>
                  Agenda una llamada conmigo
                </h3>
                <p style={{ fontSize: '13.5px', color: '#78716c', lineHeight: 1.6, maxWidth: '440px', margin: '0 auto' }}>
                  Una llamada corta para ver si esto es para ti. Si no te convence, no pasa nada.
                </p>
              </div>

              {/* Calendar + time slots */}
              <div className="vsl-sched-body" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px', marginBottom: '18px', textAlign: 'left' }}>
                {/* Month calendar */}
                <div style={{ background: '#fffaf5', border: '1px solid #fde8d4', borderRadius: '16px', padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <button type="button" className="vsl-cal-nav" disabled={!canPrevMonth} onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))} aria-label="Mes anterior">‹</button>
                    <span style={{ fontFamily: font, fontSize: '14px', fontWeight: 800, color: '#1c1917', textTransform: 'capitalize' }}>
                      {viewMonth.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
                    </span>
                    <button type="button" className="vsl-cal-nav" disabled={!canNextMonth} onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))} aria-label="Mes siguiente">›</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
                    {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => (
                      <div key={d} style={{ fontSize: '10px', fontWeight: 700, color: '#a8a29e', textTransform: 'uppercase', textAlign: 'center', letterSpacing: '0.5px', padding: '4px 0' }}>{d}</div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                    {monthCells.map((d, i) => d ? (
                      <button
                        key={i}
                        type="button"
                        className={`vsl-cal-day${isSameDay(d, selectedDate) ? ' vsl-cal-selected' : ''}`}
                        disabled={!isSelectable(d)}
                        onClick={() => setSelectedDate(d)}
                      >
                        {d.getDate()}
                      </button>
                    ) : <div key={i} />)}
                  </div>
                  <p style={{ fontSize: '11px', color: '#a8a29e', marginTop: '10px', textAlign: 'center' }}>Disponible de lunes a viernes</p>
                </div>

                {/* Time slots */}
                <div style={{ background: '#fffaf5', border: '1px solid #fde8d4', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column' }}>
                  <p style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '10px' }}>
                    Hora <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>(California)</span>
                  </p>
                  <div className="vsl-time-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {callTimes.map((time) => (
                      <button
                        key={time}
                        type="button"
                        className={`vsl-time-pill${selectedTime === time ? ' vsl-time-selected' : ''}`}
                        disabled={!selectedDate}
                        onClick={() => setSelectedTime(time)}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                  {!selectedDate && (
                    <p style={{ fontSize: '11.5px', color: '#a8a29e', marginTop: '10px', fontStyle: 'italic' }}>Primero elige un día en el calendario</p>
                  )}
                </div>
              </div>

              {booked ? (
                /* Success state */
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '16px', padding: '22px 18px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>✅</div>
                  <p style={{ fontFamily: font, fontSize: '16px', fontWeight: 800, color: '#065f46', marginBottom: '6px' }}>
                    ¡Listo, {leadName.trim().split(' ')[0]}! Tu llamada quedó solicitada.
                  </p>
                  <p style={{ fontSize: '13.5px', color: '#047857', lineHeight: 1.6, textTransform: 'none' }}>
                    <span style={{ textTransform: 'capitalize' }}>{selectedDateLabel}</span> · {selectedTime} (hora de California).<br />
                    Te confirmo por WhatsApp. Si no se abrió WhatsApp,{' '}
                    <a href={buildWaLink()} target="_blank" rel="noopener noreferrer" style={{ color: '#047857', fontWeight: 700 }}>toca aquí</a>.
                  </p>
                </div>
              ) : (
                <>
                  {/* Selection summary */}
                  {ready && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '999px', padding: '8px 16px', marginBottom: '14px' }}>
                      <span style={{ fontSize: '13px' }}>📅</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#059669', textTransform: 'capitalize' }}>{selectedDateLabel} · {selectedTime}</span>
                    </div>
                  )}

                  {/* Contact details — appear once a slot is picked */}
                  {ready && (
                    <div className="vsl-lead-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px', textAlign: 'left' }}>
                      <label style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
                        Tu nombre
                        <input
                          type="text"
                          value={leadName}
                          onChange={(e) => setLeadName(e.target.value)}
                          placeholder="María González"
                          className="vsl-input"
                        />
                      </label>
                      <label style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
                        Tu WhatsApp
                        <input
                          type="tel"
                          value={leadPhone}
                          onChange={(e) => setLeadPhone(e.target.value)}
                          placeholder="(818) 555-1234"
                          className="vsl-input"
                        />
                      </label>
                    </div>
                  )}

                  {formError && (
                    <p style={{ fontSize: '13px', color: '#e11d48', fontWeight: 600, marginBottom: '10px' }}>{formError}</p>
                  )}

                  {/* Confirm button */}
                  <button
                    type="button"
                    onClick={submitBooking}
                    className="vsl-contact-btn"
                    style={{
                      width: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                      background: ready ? 'linear-gradient(135deg, #e11d48, #f43f5e)' : '#f5f5f4',
                      color: ready ? '#fff' : '#a8a29e',
                      padding: '18px 20px',
                      borderRadius: '16px',
                      border: 'none',
                      fontWeight: 700, fontSize: '15px', fontFamily: font,
                      boxShadow: ready ? '0 8px 24px rgba(225,29,72,0.25)' : 'none',
                      cursor: ready ? 'pointer' : 'not-allowed',
                      animation: ready ? 'pulse-soft 2s infinite' : 'none',
                    }}
                  >
                    {ready ? 'Agendar mi llamada →' : 'Elige día y hora para continuar'}
                  </button>
                  <p style={{ fontSize: '12px', color: '#a8a29e', marginTop: '12px' }}>
                    Te llega la confirmación por WhatsApp. Sin compromiso, sin presión.
                  </p>
                </>
              )}
            </div>

            {/* ============ STRONG SELLING POINTS ============ */}
            <div style={{ marginBottom: '36px' }}>
              <h3 className="vsl-subheading" style={{ fontFamily: font, fontSize: '20px', fontWeight: 800, color: '#1c1917', marginBottom: '20px', letterSpacing: '-0.01em' }}>
                ¿Por qué deberías considerarlo?
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left' }}>
                {[
                  { icon: '🆓', title: 'Cero costo para ti', desc: 'No pagas absolutamente nada. Sin tarjeta. Sin compromisos.' },
                  { icon: '🙌', title: 'Tú no haces nada', desc: 'Solo compartes tu link. Eso es todo. En serio.' },
                  { icon: '🤝', title: 'Nosotros nos encargamos de TODO', desc: 'Creamos la canción, cobramos al cliente, damos soporte, manejamos reembolsos.' },
                  { icon: '💵', title: 'Tú solo ganas dinero', desc: 'Cada venta = 20% para ti. Pago mensual. Sin letra chica.' },
                ].map((item, i) => (
                  <div key={i} className="vsl-selling-card" style={{
                    background: '#fff',
                    borderRadius: '14px',
                    padding: '16px 18px',
                    border: '1px solid #fde8d4',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    boxShadow: '0 2px 8px rgba(225,110,73,0.04)',
                  }}>
                    <div className="vsl-selling-icon" style={{
                      width: '44px', height: '44px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '22px',
                      flexShrink: 0,
                    }}>
                      {item.icon}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="vsl-selling-title" style={{ fontFamily: font, fontSize: '15px', fontWeight: 700, color: '#1c1917', marginBottom: '2px' }}>{item.title}</div>
                      <div className="vsl-selling-desc" style={{ fontSize: '13px', color: '#78716c', lineHeight: 1.5 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ============ DAILY REWARDS VISUAL ============ */}
            <div className="vsl-rewards-card" style={{
              background: '#fff',
              borderRadius: '20px',
              padding: '24px',
              border: '1px solid #fde8d4',
              boxShadow: '0 4px 24px rgba(225,110,73,0.06)',
              marginBottom: '36px',
              textAlign: 'left',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px dashed #fde8d4' }}>
                <div>
                  <p style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>Recompensas de hoy</p>
                  <p style={{ fontSize: '13px', color: '#78716c' }}>Esto podría ser tu día</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '11px', color: '#a8a29e', fontWeight: 600, marginBottom: '2px' }}>Total ganado</p>
                  <p className="vsl-rewards-total" style={{ fontFamily: font, fontSize: '22px', fontWeight: 800, color: '#059669', letterSpacing: '-0.5px' }}>+$56.00</p>
                </div>
              </div>

              {/* Rewards list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { time: '9:14 AM', type: 'Canción para mamá', amount: '+$6.00', icon: '🎵' },
                  { time: '10:42 AM', type: 'Bundle de aniversario', amount: '+$8.00', icon: '🎶' },
                  { time: '11:28 AM', type: 'Canción de cumpleaños', amount: '+$6.00', icon: '🎵' },
                  { time: '1:05 PM', type: 'Bundle + Video', amount: '+$10.00', icon: '🎬' },
                  { time: '2:33 PM', type: 'Canción para boda', amount: '+$6.00', icon: '🎵' },
                  { time: '4:17 PM', type: 'Bundle de quinceañera', amount: '+$8.00', icon: '🎶' },
                  { time: '6:48 PM', type: 'Canción romántica', amount: '+$12.00', icon: '🎵', highlight: true },
                ].map((r, i) => (
                  <div key={i} className="vsl-reward-row" style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    background: r.highlight ? '#f0fdf4' : '#fef6ed',
                    border: `1px solid ${r.highlight ? '#bbf7d0' : '#fde8d4'}`,
                    gap: '10px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '18px', flexShrink: 0 }}>{r.icon}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p className="vsl-reward-title" style={{ fontSize: '13px', fontWeight: 600, color: '#1c1917', lineHeight: 1.3 }}>{r.type}</p>
                        <p style={{ fontSize: '11px', color: '#a8a29e', marginTop: '2px' }}>{r.time}</p>
                      </div>
                    </div>
                    <span className="vsl-reward-amount" style={{
                      fontFamily: font,
                      fontSize: '15px',
                      fontWeight: 800,
                      color: r.highlight ? '#059669' : '#e11d48',
                      flexShrink: 0,
                    }}>
                      {r.amount}
                    </span>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: '12px', color: '#a8a29e', textAlign: 'center', marginTop: '14px', fontStyle: 'italic' }}>
                7 ventas hoy · y el día aún no termina ✨
              </p>
            </div>

            <p style={{ fontSize: '13px', color: '#a8a29e', fontStyle: 'italic' }}>
              Gracias por tu tiempo ❤️ — Gerardo
            </p>
          </div>
        </section>

        {/* Footer — minimal */}
        <footer style={{ padding: '24px', textAlign: 'center', borderTop: '1px solid #fde8d4' }}>
          <span style={{ fontFamily: font, fontSize: '13px', fontWeight: 700, color: '#78716c' }}>
            Regalos<span style={{ color: '#e11d48' }}>QueCantan</span>
          </span>
          <p style={{ color: '#d6d3d1', fontSize: '11px', marginTop: '6px' }}>© 2026</p>
        </footer>
      </div>
    </>
  );
}
