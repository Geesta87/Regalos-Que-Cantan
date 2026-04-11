import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';

const css = `
@keyframes aff-fade-up {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes aff-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes aff-check-pop {
  0% { transform: scale(0.5); opacity: 0; }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes aff-gradient-slide {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.aff-dash {
  min-height: 100vh;
  background: #f0f5ff;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #0f172a;
  position: relative;
}

.aff-dash::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #2563eb, #7c3aed, #2563eb);
  background-size: 200% 100%;
  animation: aff-gradient-slide 4s ease infinite;
  z-index: 100;
}

/* Header */
.aff-dash-header {
  position: sticky;
  top: 2px;
  z-index: 50;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border-bottom: 1px solid rgba(232, 236, 241, 0.7);
  padding: 0 28px;
}
.aff-dash-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 64px;
}

/* Main */
.aff-dash-main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 28px 80px;
}

/* Stat cards */
.aff-stat-card {
  background: #ffffff;
  border-radius: 18px;
  padding: 26px 28px;
  border: 1px solid #e8ecf1;
  transition: transform 0.25s cubic-bezier(0.22,1,0.36,1), box-shadow 0.25s cubic-bezier(0.22,1,0.36,1);
  animation: aff-fade-up 0.5s ease-out both;
  cursor: default;
}
.aff-stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(37,99,235,0.08), 0 2px 8px rgba(0,0,0,0.04);
}
.aff-stat-card.highlight {
  background: linear-gradient(135deg, #f0f6ff 0%, #e8f0fe 100%);
  border-color: #bfdbfe;
}
.aff-stat-card.accent {
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
  border-color: #a7f3d0;
}

/* Tool cards */
.aff-tool-card {
  background: #ffffff;
  border-radius: 18px;
  padding: 24px 28px;
  border: 1px solid #e8ecf1;
  position: relative;
  overflow: hidden;
  transition: transform 0.25s cubic-bezier(0.22,1,0.36,1), box-shadow 0.25s cubic-bezier(0.22,1,0.36,1);
}
.aff-tool-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #2563eb, #7c3aed);
}
.aff-tool-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(37,99,235,0.06);
}

/* Copy button */
.aff-copy-btn {
  padding: 10px 22px;
  border-radius: 12px;
  border: 1.5px solid #2563eb;
  background: #ffffff;
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.22,1,0.36,1);
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 90px;
  justify-content: center;
}
.aff-copy-btn:hover {
  background: #2563eb;
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(37,99,235,0.25);
}
.aff-copy-btn.copied {
  background: #059669;
  border-color: #059669;
  color: #ffffff;
}

/* Date filter segmented control */
.aff-date-control {
  display: flex;
  gap: 4px;
  background: #f1f5f9;
  border-radius: 14px;
  padding: 4px;
}
.aff-date-btn {
  padding: 8px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.22,1,0.36,1);
  font-family: inherit;
  border: none;
  outline: none;
  user-select: none;
}
.aff-date-btn.active {
  background: #2563eb;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(37,99,235,0.3);
}
.aff-date-btn.inactive {
  background: transparent;
  color: #64748b;
}
.aff-date-btn.inactive:hover {
  color: #2563eb;
  background: rgba(37,99,235,0.06);
}

/* Table */
.aff-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}
.aff-table th {
  text-align: left;
  padding: 14px 24px;
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfd;
}
.aff-table th:first-child { border-radius: 12px 0 0 0; }
.aff-table th:last-child { border-radius: 0 12px 0 0; }
.aff-table td {
  padding: 16px 24px;
  font-size: 14px;
  color: #475569;
  border-bottom: 1px solid #f8fafc;
}
.aff-table tr:nth-child(even) td { background: #fafbfd; }
.aff-table tr:hover td { background: #f1f5f9; }
.aff-table tr:last-child td { border-bottom: none; }

/* Logout button */
.aff-logout-btn {
  padding: 8px 18px;
  border-radius: 10px;
  border: 1px solid #e8ecf1;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.aff-logout-btn:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: #fef2f2;
}

/* Loading skeleton */
.aff-loading {
  background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%;
  animation: aff-shimmer 1.5s infinite;
  border-radius: 18px;
  height: 140px;
}

/* Tip cards */
.aff-tip-card {
  background: #ffffff;
  border-radius: 18px;
  padding: 24px;
  border: 1px solid #e8ecf1;
  transition: transform 0.25s cubic-bezier(0.22,1,0.36,1), box-shadow 0.25s cubic-bezier(0.22,1,0.36,1);
  cursor: default;
  animation: aff-fade-up 0.5s ease-out both;
}
.aff-tip-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(37,99,235,0.08), 0 2px 8px rgba(0,0,0,0.04);
}

/* Badge pills */
.aff-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.aff-badge-green {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}
.aff-badge-red {
  background: #fef2f2;
  color: #ef4444;
  border: 1px solid #fecaca;
}

/* Responsive */
@media (max-width: 768px) {
  .aff-dash-header { padding: 0 12px; }
  .aff-dash-main { padding: 16px 14px 90px; }
  .aff-stat-card { padding: 18px 16px; }
  .aff-tool-card { padding: 16px; }
  .aff-table th, .aff-table td { padding: 10px 12px; font-size: 11px; }
  .aff-date-btn { padding: 6px 12px; font-size: 11px; }
  .aff-welcome-title { font-size: 22px !important; }
  .aff-welcome-row { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
  .aff-tools-grid { grid-template-columns: 1fr !important; }
  .aff-stats-grid { grid-template-columns: 1fr 1fr !important; gap: 10px !important; }
  .aff-stat-value { font-size: 24px !important; }
  .aff-tips-grid { grid-template-columns: 1fr !important; }
  .aff-header-brand { font-size: 14px !important; }
  .aff-header-badge { display: none !important; }
  .aff-transparency-bar { flex-direction: column !important; text-align: center; gap: 8px !important; padding: 14px 16px !important; }
  .aff-script-card { padding: 20px !important; }
  .aff-script-text { font-size: 13px !important; padding: 16px !important; }
  .aff-payout-card { padding: 16px !important; }
  .aff-date-container { padding: 3px !important; }
  .aff-tool-code { font-size: 11px !important; }
  .aff-coupon-code { font-size: 14px !important; letter-spacing: 2px !important; }
  .aff-empty-state { padding: 40px 16px !important; }
  .aff-empty-icon { font-size: 40px !important; }
}

@media (max-width: 480px) {
  .aff-stats-grid { grid-template-columns: 1fr !important; }
  .aff-stat-card { padding: 16px 14px; }
}
`;

// ───────────────────────────────────────────────────────────────────
// Sparkline — tiny SVG line + dot showing the last 14 days of a metric
// ───────────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#2563eb', height = 28 }) {
  if (!data || data.length === 0) {
    return <div style={{ height, opacity: 0.3, fontSize: 10, color: '#94a3b8' }}>—</div>;
  }
  const width = 110;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - 4 - ((v - min) / range) * (height - 8);
    return `${x},${y}`;
  }).join(' ');
  const last = data[data.length - 1];
  const lastX = (data.length - 1) * step;
  const lastY = height - 4 - ((last - min) / range) * (height - 8);
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// Build the last N days of a metric from dailyStats, padding zeros for missing days
function buildSparklineSeries(dailyStats, key, days = 14) {
  if (!dailyStats) return [];
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const iso = d.toISOString().split('T')[0];
    result.push(dailyStats[iso]?.[key] || 0);
  }
  return result;
}

export default function AffiliateDashboard() {
  const { navigateTo } = useContext(AppContext);
  const [affiliate, setAffiliate] = useState(null);
  const [token, setToken] = useState('');
  const [stats, setStats] = useState(null);
  const [recentPurchases, setRecentPurchases] = useState([]);
  const [recentPayouts, setRecentPayouts] = useState([]);
  const [dailyStats, setDailyStats] = useState({});
  const [attribution, setAttribution] = useState({ couponSales: 0, linkSales: 0, couponRevenue: 0, linkRevenue: 0 });
  const [utmBreakdown, setUtmBreakdown] = useState([]);
  const [weeklyGoal, setWeeklyGoal] = useState({ target: 10, current: 0, lastWeek: 0 });
  const [refundWindowDays, setRefundWindowDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(30);
  const [copied, setCopied] = useState('');
  const [toast, setToast] = useState(null); // { commission, when }
  const lastSeenPurchasesRef = React.useRef(0);

  useEffect(() => {
    const auth = localStorage.getItem('rqc_affiliate_auth');
    if (!auth) { navigateTo('affiliateLogin'); return; }
    try {
      const data = JSON.parse(auth);
      if (!data.token || !data.affiliate) throw new Error();
      if (Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem('rqc_affiliate_auth');
        navigateTo('affiliateLogin');
        return;
      }
      setAffiliate(data.affiliate);
      setToken(data.token);
    } catch {
      localStorage.removeItem('rqc_affiliate_auth');
      navigateTo('affiliateLogin');
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchData({ initial: true });
    // Poll every 30 seconds so the dashboard feels live without realtime infra
    const interval = setInterval(() => fetchData({ initial: false }), 30000);
    return () => clearInterval(interval);
  }, [token, dateRange]);

  const fetchData = async ({ initial }) => {
    if (initial) setLoading(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/affiliate-data?days=${dateRange}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (data.success) {
        // Toast on new sale: compare current totalPurchases against last seen
        if (!initial && data.stats?.totalPurchases > lastSeenPurchasesRef.current) {
          // The most recent purchase is at the top of recentPurchases (already sorted desc)
          const newest = (data.recentPurchases || []).find(p => p.type === 'purchase');
          if (newest) {
            setToast({ commission: newest.commission, when: Date.now() });
            // Auto-dismiss after 6 seconds
            setTimeout(() => setToast(null), 6000);
          }
        }
        lastSeenPurchasesRef.current = data.stats?.totalPurchases || 0;

        setStats(data.stats);
        setRecentPurchases(data.recentPurchases || []);
        setRecentPayouts(data.recentPayouts || []);
        setDailyStats(data.dailyStats || {});
        setAttribution(data.attribution || { couponSales: 0, linkSales: 0, couponRevenue: 0, linkRevenue: 0 });
        setUtmBreakdown(data.utmBreakdown || []);
        setWeeklyGoal(data.weeklyGoal || { target: 10, current: 0, lastWeek: 0 });
        setRefundWindowDays(data.refundWindowDays || 14);
      } else if (response.status === 401) {
        localStorage.removeItem('rqc_affiliate_auth');
        navigateTo('affiliateLogin');
      }
    } catch (err) { console.error('Failed to fetch affiliate data:', err); }
    finally { if (initial) setLoading(false); }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  if (!affiliate) return null;
  const affiliateLink = `https://regalosquecantan.com/?ref=${affiliate.code}`;
  const firstName = affiliate.name.split(' ')[0];

  const dateOptions = [
    { d: 1, l: 'Ahora' },
    { d: 7, l: '7D' },
    { d: 30, l: '30D' },
    { d: 0, l: 'Todo' },
  ];

  const CheckIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'aff-check-pop 0.3s ease-out' }}>
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M9.5 4.5V2.5C9.5 1.67 8.83 1 8 1H2.5C1.67 1 1 1.67 1 2.5V8C1 8.83 1.67 9.5 2.5 9.5H4.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );

  return (
    <>
      <style>{css}</style>
      {/* Real-time commission toast (fires when polling detects a new sale) */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1000,
          background: '#ffffff',
          border: '1px solid #a7f3d0',
          borderLeft: '4px solid #059669',
          borderRadius: 14,
          padding: '16px 22px',
          boxShadow: '0 16px 40px rgba(5,150,105,0.18), 0 4px 12px rgba(0,0,0,0.06)',
          display: 'flex', alignItems: 'center', gap: 14,
          animation: 'aff-fade-up 0.4s ease-out',
          maxWidth: 360
        }}>
          <div style={{
            fontSize: 28, width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0
          }}>🎉</div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: '#059669', textTransform: 'uppercase', letterSpacing: 1.5, margin: '0 0 4px' }}>
              ¡Nueva venta!
            </p>
            <p style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
              +${(toast.commission || 0).toFixed(2)} <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>de comision</span>
            </p>
          </div>
          <button
            onClick={() => setToast(null)}
            style={{
              background: 'transparent', border: 'none',
              color: '#94a3b8', cursor: 'pointer',
              fontSize: 18, padding: 4, lineHeight: 1
            }}
            aria-label="Cerrar"
          >×</button>
        </div>
      )}
      <div className="aff-dash">

        {/* -------- HEADER -------- */}
        <header className="aff-dash-header">
          <div className="aff-dash-header-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 12,
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, color: '#fff', flexShrink: 0
              }}>
                <span role="img" aria-label="music">🎵</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="aff-header-brand" style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>RegalosQueCantan</span>
                <span className="aff-header-badge" style={{
                  fontSize: 10, fontWeight: 700, color: '#2563eb', letterSpacing: 1.2,
                  textTransform: 'uppercase', background: '#eff6ff', padding: '4px 10px',
                  borderRadius: 8, border: '1px solid #dbeafe'
                }}>Partner Portal</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800, color: '#ffffff',
                  boxShadow: '0 2px 8px rgba(37,99,235,0.25)'
                }}>
                  {firstName[0]}
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', display: 'none' }} className="aff-name-desktop">{firstName}</span>
              </div>
              <button
                onClick={() => { localStorage.removeItem('rqc_affiliate_auth'); navigateTo('affiliateLogin'); }}
                className="aff-logout-btn"
              >
                Salir
              </button>
            </div>
          </div>
        </header>

        <main className="aff-dash-main">

          {/* -------- WELCOME BAR -------- */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 28, flexWrap: 'wrap', gap: 16,
            animation: 'aff-fade-up 0.4s ease-out both'
          }} className="aff-welcome-row">
            <div>
              <h2 className="aff-welcome-title" style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 4px', letterSpacing: -0.5 }}>
                Bienvenido, {firstName} <span role="img" aria-label="wave" style={{ fontSize: 26 }}>👋</span>
              </h2>
              <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>Aqui esta tu resumen de actividad</p>
            </div>
            <div className="aff-date-control">
              {dateOptions.map(({ d, l }) => (
                <button
                  key={d}
                  onClick={() => setDateRange(d)}
                  className={`aff-date-btn ${dateRange === d ? 'active' : 'inactive'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* -------- TOOLS SECTION -------- */}
          <div className="aff-tools-grid" style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16, marginBottom: 28,
            animation: 'aff-fade-up 0.5s ease-out 0.05s both'
          }}>
            {/* Link card */}
            <div className="aff-tool-card">
              <label style={{
                fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
                letterSpacing: 2, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: '#2563eb' }}>
                  <path d="M6 8L8 6M5.5 9.5L3.35 11.65C2.56 12.44 1.27 12.44 0.48 11.65V11.65C-0.31 10.86-0.31 9.57 0.48 8.78L2.64 6.62M11.36 7.38L13.52 5.22C14.31 4.43 14.31 3.14 13.52 2.35V2.35C12.73 1.56 11.44 1.56 10.65 2.35L8.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Tu Link
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{
                  flex: 1, padding: '12px 16px', background: '#f8fafc', borderRadius: 12,
                  border: '1px solid #e8ecf1', fontSize: 13, color: '#475569',
                  wordBreak: 'break-all', fontFamily: "'SF Mono', 'Fira Code', monospace",
                  lineHeight: 1.5
                }}>
                  {affiliateLink}
                </div>
                <button
                  onClick={() => copyToClipboard(affiliateLink, 'link')}
                  className={`aff-copy-btn ${copied === 'link' ? 'copied' : ''}`}
                >
                  {copied === 'link' ? <CheckIcon /> : <CopyIcon />}
                  {copied === 'link' ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>

            {/* Coupon card */}
            {affiliate.coupon_code && (
              <div className="aff-tool-card">
                <label style={{
                  fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
                  letterSpacing: 2, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: '#7c3aed' }}>
                    <path d="M1 5V2C1 1.45 1.45 1 2 1H12C12.55 1 13 1.45 13 2V5C11.9 5 11 5.9 11 7C11 8.1 11.9 9 13 9V12C13 12.55 12.55 13 12 13H2C1.45 13 1 12.55 1 12V9C2.1 9 3 8.1 3 7C3 5.9 2.1 5 1 5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Tu Codigo
                </label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{
                    flex: 1, padding: '12px 16px', background: '#f8fafc', borderRadius: 12,
                    border: '1px solid #e8ecf1', fontSize: 22, fontWeight: 800,
                    color: '#0f172a', letterSpacing: 4,
                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                    textAlign: 'center'
                  }}>
                    {affiliate.coupon_code}
                  </div>
                  <button
                    onClick={() => copyToClipboard(affiliate.coupon_code, 'coupon')}
                    className={`aff-copy-btn ${copied === 'coupon' ? 'copied' : ''}`}
                  >
                    {copied === 'coupon' ? <CheckIcon /> : <CopyIcon />}
                    {copied === 'coupon' ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* -------- STATS GRID -------- */}
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 16 }}>
              {[1,2,3,4,5,6].map(i => <div key={i} className="aff-loading" />)}
            </div>
          ) : stats ? (
            <>
              <div className="aff-stats-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 16, marginBottom: 28
              }}>
                {[
                  {
                    label: 'Visitantes', value: stats.visits,
                    icon: '👁️', iconBg: '#eff6ff', iconColor: '#2563eb',
                    sub: 'Clicks en tu link', delay: '0s', cls: '',
                    series: buildSparklineSeries(dailyStats, 'visits'), sparkColor: '#2563eb'
                  },
                  {
                    label: 'Checkouts', value: stats.checkouts,
                    icon: '🛒', iconBg: '#fef3c7', iconColor: '#d97706',
                    sub: 'Iniciaron compra', delay: '0.06s', cls: '',
                    series: buildSparklineSeries(dailyStats, 'checkouts'), sparkColor: '#d97706'
                  },
                  {
                    label: 'Ventas', value: stats.totalPurchases,
                    icon: '✅', iconBg: '#ecfdf5', iconColor: '#059669',
                    sub: 'Completadas', delay: '0.12s', cls: '',
                    series: buildSparklineSeries(dailyStats, 'purchases'), sparkColor: '#059669'
                  },
                  {
                    label: 'Conversion', value: `${stats.conversionRate}%`,
                    icon: '📈', iconBg: '#fdf4ff', iconColor: '#a855f7',
                    sub: 'Visitantes → Ventas', delay: '0.18s', cls: ''
                  },
                  {
                    label: 'Ticket promedio', value: `$${(stats.aov || 0).toFixed(2)}`,
                    icon: '🧾', iconBg: '#fef9c3', iconColor: '#ca8a04',
                    sub: 'Por venta', delay: '0.21s', cls: ''
                  },
                  {
                    label: 'Ingresos', value: `$${stats.totalRevenue.toFixed(2)}`,
                    icon: '💵', iconBg: '#dbeafe', iconColor: '#2563eb',
                    sub: 'Total generado', delay: '0.24s', cls: 'highlight',
                    valueColor: '#2563eb', labelColor: '#2563eb',
                    series: buildSparklineSeries(dailyStats, 'revenue'), sparkColor: '#2563eb'
                  },
                  {
                    label: 'Tu Comision', value: `$${stats.totalCommission.toFixed(2)}`,
                    icon: '🏆', iconBg: '#d1fae5', iconColor: '#059669',
                    sub: `${stats.commissionPct}% de ingresos`, delay: '0.30s', cls: 'accent',
                    valueColor: '#059669', labelColor: '#059669',
                    series: buildSparklineSeries(dailyStats, 'commission'), sparkColor: '#059669'
                  },
                ].map((s, i) => (
                  <div
                    key={i}
                    className={`aff-stat-card ${s.cls}`}
                    style={{ animationDelay: s.delay }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 12,
                      background: s.iconBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18, marginBottom: 16
                    }}>
                      {s.icon}
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: s.labelColor || '#94a3b8',
                      textTransform: 'uppercase', letterSpacing: 1.5,
                      display: 'block', marginBottom: 6
                    }}>
                      {s.label}
                    </span>
                    <div className="aff-stat-value" style={{
                      fontSize: 32, fontWeight: 800,
                      color: s.valueColor || '#0f172a',
                      letterSpacing: -0.5, lineHeight: 1.1, marginBottom: 6
                    }}>
                      {s.value}
                    </div>
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>{s.sub}</p>
                    {s.series && (
                      <div style={{ marginTop: 10 }}>
                        <Sparkline data={s.series} color={s.sparkColor} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* -------- COMMISSION SPLIT (Available / Pending / Paid) -------- */}
              <div style={{
                background: '#ffffff', borderRadius: 20,
                border: '1px solid #e8ecf1', padding: '24px 28px',
                marginBottom: 28,
                animation: 'aff-fade-up 0.5s ease-out 0.32s both'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                  <span style={{ fontSize: 18 }}>💸</span>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Tus comisiones</h3>
                </div>
                <div className="aff-stats-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 14
                }}>
                  {[
                    {
                      label: 'Disponible para pagar', value: stats.availableCommission ?? 0,
                      sub: `Listo despues del periodo de ${refundWindowDays} dias`,
                      color: '#059669', bg: '#ecfdf5', border: '#a7f3d0'
                    },
                    {
                      label: 'Pendiente', value: stats.pendingCommission ?? 0,
                      sub: `Dentro de ${refundWindowDays} dias de la venta`,
                      color: '#d97706', bg: '#fffbeb', border: '#fde68a'
                    },
                    {
                      label: 'Pagado a la fecha', value: stats.paidCommission ?? 0,
                      sub: 'Total enviado a tu cuenta',
                      color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe'
                    },
                  ].map((c, i) => (
                    <div key={i} style={{
                      background: c.bg, borderRadius: 14, padding: '18px 20px',
                      border: `1px solid ${c.border}`
                    }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: c.color,
                        textTransform: 'uppercase', letterSpacing: 1.5,
                        display: 'block', marginBottom: 8
                      }}>
                        {c.label}
                      </span>
                      <div style={{
                        fontSize: 28, fontWeight: 800, color: c.color,
                        letterSpacing: -0.5, lineHeight: 1.1, marginBottom: 4
                      }}>
                        ${(Number(c.value) || 0).toFixed(2)}
                      </div>
                      <p style={{ fontSize: 11, color: '#64748b', margin: 0, lineHeight: 1.4 }}>{c.sub}</p>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '14px 0 0', textAlign: 'center' }}>
                  Las comisiones pasan de <strong style={{ color: '#d97706' }}>Pendiente</strong> a <strong style={{ color: '#059669' }}>Disponible</strong> automaticamente despues de {refundWindowDays} dias (periodo de reembolso).
                </p>
              </div>

              {/* -------- WEEKLY GOAL -------- */}
              {(() => {
                const pct = Math.min(100, weeklyGoal.target > 0 ? (weeklyGoal.current / weeklyGoal.target) * 100 : 0);
                const remaining = Math.max(0, weeklyGoal.target - weeklyGoal.current);
                return (
                  <div style={{
                    background: '#ffffff', borderRadius: 20,
                    border: '1px solid #e8ecf1', padding: '22px 28px',
                    marginBottom: 28,
                    animation: 'aff-fade-up 0.5s ease-out 0.34s both'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 18 }}>🎯</span>
                        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Meta semanal</h3>
                      </div>
                      <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
                        <span style={{ color: '#0f172a', fontWeight: 800 }}>{weeklyGoal.current}</span> / {weeklyGoal.target} ventas
                      </span>
                    </div>
                    <div style={{
                      height: 10, background: '#f1f5f9', borderRadius: 10, overflow: 'hidden',
                      marginBottom: 10
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: pct >= 100
                          ? 'linear-gradient(90deg, #059669, #10b981)'
                          : 'linear-gradient(90deg, #2563eb, #7c3aed)',
                        borderRadius: 10,
                        transition: 'width 0.6s ease-out'
                      }} />
                    </div>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
                      {pct >= 100
                        ? '🔥 ¡Meta alcanzada esta semana! Sigue asi.'
                        : remaining === 1
                          ? 'Te falta 1 venta para llegar a la meta de esta semana.'
                          : `Te faltan ${remaining} ventas para llegar a la meta de esta semana.`
                      }
                      {weeklyGoal.lastWeek > 0 && (
                        <span style={{ marginLeft: 8, color: '#94a3b8' }}>
                          · La semana pasada: {weeklyGoal.lastWeek} ventas
                        </span>
                      )}
                    </p>
                  </div>
                );
              })()}

              {/* -------- COUPON vs LINK BREAKDOWN -------- */}
              {(attribution.couponSales + attribution.linkSales) > 0 && (
                <div style={{
                  background: '#ffffff', borderRadius: 20,
                  border: '1px solid #e8ecf1', padding: '22px 28px',
                  marginBottom: 28,
                  animation: 'aff-fade-up 0.5s ease-out 0.36s both'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 18 }}>🔀</span>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Codigo vs Link</h3>
                  </div>
                  {(() => {
                    const total = attribution.couponSales + attribution.linkSales;
                    const couponPct = total > 0 ? (attribution.couponSales / total) * 100 : 0;
                    const linkPct = 100 - couponPct;
                    return (
                      <>
                        <div style={{
                          display: 'flex', height: 12, borderRadius: 10, overflow: 'hidden',
                          marginBottom: 14, background: '#f1f5f9'
                        }}>
                          {couponPct > 0 && <div style={{ width: `${couponPct}%`, background: '#a855f7' }} />}
                          {linkPct > 0 && <div style={{ width: `${linkPct}%`, background: '#2563eb' }} />}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                          <div style={{ background: '#faf5ff', borderRadius: 12, padding: '14px 16px', border: '1px solid #e9d5ff' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#a855f7' }} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1 }}>Por codigo</span>
                            </div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{attribution.couponSales} <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>ventas</span></div>
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>${attribution.couponRevenue.toFixed(2)} en ingresos</div>
                          </div>
                          <div style={{ background: '#eff6ff', borderRadius: 12, padding: '14px 16px', border: '1px solid #bfdbfe' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: '#2563eb' }} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 1 }}>Por link</span>
                            </div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{attribution.linkSales} <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>ventas</span></div>
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>${attribution.linkRevenue.toFixed(2)} en ingresos</div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* -------- PER-CHANNEL UTM BREAKDOWN -------- */}
              {utmBreakdown.length > 0 && (
                <div style={{
                  background: '#ffffff', borderRadius: 20,
                  border: '1px solid #e8ecf1', padding: '22px 28px',
                  marginBottom: 28,
                  animation: 'aff-fade-up 0.5s ease-out 0.38s both'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 18 }}>📡</span>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Por plataforma</h3>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {utmBreakdown.map((row) => {
                      const max = Math.max(...utmBreakdown.map(r => r.sales), 1);
                      const pct = (row.sales / max) * 100;
                      const platformIcons = { tiktok: '🎵', instagram: '📷', youtube: '▶️', email: '📧', whatsapp: '💬', facebook: '👥', twitter: '🐦', directo: '🔗' };
                      const icon = platformIcons[row.source] || '🌐';
                      return (
                        <div key={row.source}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600, textTransform: 'capitalize' }}>
                              {icon} {row.source}
                            </span>
                            <span style={{ fontSize: 12, color: '#64748b' }}>
                              <strong style={{ color: '#0f172a' }}>{row.sales}</strong> ventas · ${row.revenue.toFixed(2)} · <strong style={{ color: '#059669' }}>${row.commission.toFixed(2)} comision</strong>
                            </span>
                          </div>
                          <div style={{ height: 6, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #2563eb, #7c3aed)', borderRadius: 6 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* -------- PER-CHANNEL LINK GENERATOR -------- */}
              <div style={{
                background: '#ffffff', borderRadius: 20,
                border: '1px solid #e8ecf1', padding: '22px 28px',
                marginBottom: 28,
                animation: 'aff-fade-up 0.5s ease-out 0.40s both'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>🔗</span>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Links por plataforma</h3>
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px' }}>
                  Usa un link diferente en cada red para saber cual te genera mas ventas.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { source: 'tiktok', label: 'TikTok', icon: '🎵' },
                    { source: 'instagram', label: 'Instagram', icon: '📷' },
                    { source: 'youtube', label: 'YouTube', icon: '▶️' },
                    { source: 'whatsapp', label: 'WhatsApp', icon: '💬' },
                  ].map(({ source, label, icon }) => {
                    const link = `https://regalosquecantan.com/?ref=${affiliate.code}&utm_source=${source}`;
                    const copyKey = `link_${source}`;
                    return (
                      <div key={source} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '12px 14px', background: '#f8fafc',
                        borderRadius: 12, border: '1px solid #e2e8f0'
                      }}>
                        <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', minWidth: 80 }}>{label}</span>
                        <code style={{
                          flex: 1, fontSize: 11, color: '#64748b',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          fontFamily: 'ui-monospace, monospace'
                        }}>{link}</code>
                        <button
                          onClick={() => copyToClipboard(link, copyKey)}
                          style={{
                            padding: '6px 12px',
                            background: copied === copyKey ? '#dcfce7' : '#eff6ff',
                            color: copied === copyKey ? '#059669' : '#2563eb',
                            border: `1px solid ${copied === copyKey ? '#86efac' : '#bfdbfe'}`,
                            borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {copied === copyKey ? '✓ Copiado' : 'Copiar'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* -------- TRANSPARENCY BANNER -------- */}
              <div style={{
                display: 'flex', gap: 14, alignItems: 'center',
                background: 'linear-gradient(135deg, #f0f7ff, #eff6ff)',
                borderRadius: 16, padding: '14px 22px', marginBottom: 28,
                border: '1px solid #dbeafe',
                animation: 'aff-fade-up 0.5s ease-out 0.35s both'
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: '#dbeafe',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, flexShrink: 0
                }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 3C5 3 1.73 5.48 0.5 9C1.73 12.52 5 15 9 15C13 15 16.27 12.52 17.5 9C16.27 5.48 13 3 9 3Z" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="9" cy="9" r="2.5" stroke="#2563eb" strokeWidth="1.5"/>
                  </svg>
                </div>
                <p style={{ fontSize: 13, color: '#475569', margin: 0, lineHeight: 1.6 }}>
                  <strong style={{ color: '#0f172a' }}>Transparencia total</strong> — Datos actualizados en tiempo real. Ves exactamente lo que generan tu link y tu codigo.
                </p>
              </div>

              {/* -------- RECENT ACTIVITY TABLE -------- */}
              <div style={{
                background: '#ffffff', borderRadius: 20,
                border: '1px solid #e8ecf1', overflow: 'hidden',
                animation: 'aff-fade-up 0.5s ease-out 0.38s both',
                marginBottom: 28
              }}>
                <div style={{
                  padding: '22px 28px 0',
                  display: 'flex', alignItems: 'center', gap: 10
                }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 1V9L13 13" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="9" cy="9" r="8" stroke="#2563eb" strokeWidth="1.5"/>
                  </svg>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Actividad reciente</h3>
                </div>
                {recentPurchases.length > 0 ? (
                  <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
                    <table className="aff-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Tipo</th>
                          <th>Monto</th>
                          <th>Tu comision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentPurchases.map((p, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 500 }}>
                              {new Date(p.date).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td>
                              {p.type === 'refund' ? (
                                <span className="aff-badge aff-badge-red">❌ Reembolso</span>
                              ) : (
                                <span className="aff-badge aff-badge-green">✅ Venta</span>
                              )}
                            </td>
                            <td style={{
                              color: p.type === 'refund' ? '#ef4444' : '#0f172a',
                              fontWeight: 600
                            }}>
                              {p.type === 'refund' ? `-$${Math.abs(p.amount).toFixed(2)}` : `$${p.amount.toFixed(2)}`}
                            </td>
                            <td style={{
                              color: p.type === 'refund' ? '#ef4444' : '#059669',
                              fontWeight: 700
                            }}>
                              {p.type === 'refund' ? `-$${Math.abs(p.commission).toFixed(2)}` : `+$${p.commission.toFixed(2)}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '48px 24px 56px' }}>
                    <div style={{ fontSize: 52, marginBottom: 16, opacity: 0.6 }}>📭</div>
                    <p style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>Aun no hay ventas</p>
                    <p style={{ fontSize: 14, color: '#64748b', margin: 0, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.7 }}>
                      Comparte tu link o codigo con tu audiencia para empezar a generar comisiones.
                    </p>
                  </div>
                )}
              </div>

              {/* -------- PAYOUT HISTORY -------- */}
              <div style={{
                background: '#ffffff', borderRadius: 20,
                border: '1px solid #e8ecf1', overflow: 'hidden',
                animation: 'aff-fade-up 0.5s ease-out 0.42s both',
                marginBottom: 28
              }}>
                <div style={{
                  padding: '22px 28px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  flexWrap: 'wrap', gap: 12
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <rect x="1" y="3" width="16" height="12" rx="2" stroke="#059669" strokeWidth="1.5"/>
                        <path d="M1 7H17" stroke="#059669" strokeWidth="1.5"/>
                      </svg>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Historial de pagos</h3>
                    </div>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0, paddingLeft: 28 }}>Pagos mensuales via Zelle, Venmo o PayPal</p>
                  </div>
                  <div style={{
                    padding: '8px 16px', borderRadius: 12,
                    background: '#ecfdf5', border: '1px solid #a7f3d0'
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>
                      Pendiente: ${stats.totalCommission.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div style={{ padding: '0 28px 28px' }}>
                  <div style={{
                    background: '#fafbfd', borderRadius: 16,
                    border: '1px solid #e8ecf1', padding: '36px 24px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.5 }}>💸</div>
                    <p style={{ fontSize: 15, fontWeight: 600, color: '#64748b', margin: '0 0 6px' }}>Aun no hay pagos registrados</p>
                    <p style={{
                      fontSize: 13, color: '#94a3b8', margin: 0, maxWidth: 380,
                      marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.7
                    }}>
                      Los pagos se procesan mensualmente. Cuando alcances el minimo de <strong style={{ color: '#475569' }}>$20 USD</strong>, recibiras tu primer pago.
                    </p>
                  </div>
                </div>
              </div>

              {/* -------- PROMOTION TIPS -------- */}
              <div style={{ marginBottom: 28, animation: 'aff-fade-up 0.5s ease-out 0.46s both' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M10 1L12.47 6.6L18.6 7.35L14.05 11.4L15.35 17.4L10 14.27L4.65 17.4L5.95 11.4L1.4 7.35L7.53 6.6L10 1Z" stroke="#2563eb" strokeWidth="1.5" strokeLinejoin="round"/>
                  </svg>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Ideas para promover</h3>
                </div>
                <div className="aff-tips-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: 14
                }}>
                  {[
                    { icon: '🎬', title: 'Graba la reaccion', desc: 'Filma a alguien recibiendo su cancion personalizada. Los videos de reaccion son el contenido que mas convierte.', tag: 'TikTok / Reels', delay: '0.48s' },
                    { icon: '🔗', title: 'Link en tu bio', desc: 'Agrega tu link de afiliado a tu bio de Instagram, TikTok o YouTube. Trafico pasivo 24/7.', tag: 'Todas las redes', delay: '0.52s' },
                    { icon: '📖', title: 'Cuenta una historia', desc: '"Le regale una cancion a mi mama y lloro de felicidad" — las historias personales venden mas que cualquier anuncio.', tag: 'Stories / Posts', delay: '0.56s' },
                    { icon: '🎁', title: 'Fechas especiales', desc: 'Antes del Dia de las Madres, San Valentin, cumpleanos... recuerda a tu audiencia que este es el regalo perfecto.', tag: 'Contenido estacional', delay: '0.60s' },
                    { icon: '💬', title: 'Comparte tu codigo', desc: 'Menciona tu codigo de descuento en tus videos: "Usen mi codigo [TU_CODIGO] para un descuento especial."', tag: 'Videos / Lives', delay: '0.64s' },
                    { icon: '🎵', title: 'Reproduce la cancion', desc: 'Pon una cancion de ejemplo en tu story o video. Que tu audiencia escuche la calidad. El producto se vende solo.', tag: 'Audio / Video', delay: '0.68s' },
                  ].map((tip, i) => (
                    <div key={i} className="aff-tip-card" style={{ animationDelay: tip.delay }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 14,
                          background: '#f8fafc', border: '1px solid #e8ecf1',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 22
                        }}>
                          {tip.icon}
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: '#2563eb',
                          textTransform: 'uppercase', letterSpacing: 1,
                          padding: '5px 12px', background: '#eff6ff',
                          borderRadius: 8, border: '1px solid #dbeafe'
                        }}>
                          {tip.tag}
                        </span>
                      </div>
                      <h4 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>{tip.title}</h4>
                      <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.7 }}>{tip.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* -------- SAMPLE SCRIPT -------- */}
              <div style={{
                background: '#ffffff', borderRadius: 20,
                border: '1px solid #e8ecf1', overflow: 'hidden',
                animation: 'aff-fade-up 0.5s ease-out 0.72s both',
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                  background: 'linear-gradient(90deg, #7c3aed, #2563eb)',
                  borderRadius: '20px 20px 0 0'
                }} />
                <div style={{ padding: '28px 32px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12,
                      background: 'linear-gradient(135deg, #ede9fe, #f0f0ff)',
                      border: '1px solid #ddd6fe',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18
                    }}>
                      🎤
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Guion de ejemplo para tu contenido</h3>
                  </div>
                  <div style={{
                    background: '#fafaff', borderRadius: 16,
                    padding: '24px 28px', border: '1px solid #ede9fe'
                  }}>
                    <p style={{
                      fontSize: 15, color: '#475569', margin: 0, lineHeight: 1.9,
                      fontStyle: 'italic'
                    }}>
                      "¿Quieres darle a alguien un regalo que NUNCA va a olvidar? Imaginate regalarle una cancion con SU nombre, contando SU historia, en el genero que mas le gusta — corrido, cumbia, bachata, lo que quieras. Asi funciona RegalosQueCantan. Tu eliges todo, y en minutos tienes una cancion unica que no existe en ningun otro lugar del mundo. Usa mi codigo <strong style={{ color: '#2563eb', fontStyle: 'normal', background: '#eff6ff', padding: '2px 8px', borderRadius: 6 }}>{affiliate.coupon_code || '[TU_CODIGO]'}</strong> para un descuento especial. El link esta en mi bio."
                    </p>
                  </div>
                  <p style={{
                    fontSize: 12, color: '#94a3b8', margin: '16px 0 0',
                    textAlign: 'center'
                  }}>
                    Adaptalo a tu estilo — lo importante es que sea autentico y tuyo
                  </p>
                </div>
              </div>
            </>
          ) : null}

          {/* -------- FLOATING WHATSAPP BUTTON -------- */}
          <a
            href="https://wa.me/12136666619?text=Hola%2C%20soy%20afiliado%20de%20RegalosQueCantan%20y%20tengo%20una%20pregunta"
            target="_blank"
            rel="noopener noreferrer"
            className="aff-support-btn"
            style={{ position: 'fixed', bottom: 28, right: 28, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 22px', borderRadius: 50, background: 'linear-gradient(135deg, #25d366, #128c7e)', color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 700, boxShadow: '0 8px 24px rgba(37,211,102,0.3)', transition: 'transform 0.2s, box-shadow 0.2s', zIndex: 50, fontFamily: 'inherit' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(37,211,102,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(37,211,102,0.3)'; }}
          >
            <span style={{ fontSize: 20 }}>💬</span>
            ¿Necesitas ayuda?
          </a>
        </main>
      </div>
    </>
  );
}
