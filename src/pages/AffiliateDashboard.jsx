import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';

const css = `
@keyframes aff-fade-up {
  from { opacity: 0; transform: translateY(12px); }
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

.aff-dash {
  min-height: 100vh;
  background: #fafafa;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11', 'ss01';
  color: #0a0a0a;
  position: relative;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Tabular numbers throughout — keeps stat cards/tables aligned */
.aff-dash *,
.aff-dash :where(td, th, .aff-num) {
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11', 'ss01', 'tnum';
}

/* Header */
.aff-dash-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid #ececec;
  padding: 0 28px;
}
.aff-dash-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
}

/* Main */
.aff-dash-main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 36px 28px 96px;
}

/* Section card — used for commission split, goal, attribution, etc */
.aff-section-card {
  background: #ffffff;
  border-radius: 14px;
  padding: 22px 26px;
  border: 1px solid #ececec;
  box-shadow: 0 1px 2px rgba(10,10,10,0.04);
}

/* Stat cards */
.aff-stat-card {
  background: #ffffff;
  border-radius: 14px;
  padding: 22px 24px;
  border: 1px solid #ececec;
  box-shadow: 0 1px 2px rgba(10,10,10,0.04);
  transition: transform 0.2s cubic-bezier(0.22,1,0.36,1), box-shadow 0.2s cubic-bezier(0.22,1,0.36,1), border-color 0.2s;
  animation: aff-fade-up 0.4s ease-out both;
  cursor: default;
}
.aff-stat-card:hover {
  transform: translateY(-1px);
  border-color: #d4d4d4;
  box-shadow: 0 1px 2px rgba(10,10,10,0.04), 0 8px 24px -8px rgba(10,10,10,0.08);
}
.aff-stat-card.highlight {
  background: #ffffff;
  border-color: #ececec;
}
.aff-stat-card.accent {
  background: #ffffff;
  border-color: #ececec;
}
.aff-stat-card .aff-stat-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
  background: #f5f5f5;
  color: #525252;
}

/* Tool cards */
.aff-tool-card {
  background: #ffffff;
  border-radius: 14px;
  padding: 22px 26px;
  border: 1px solid #ececec;
  box-shadow: 0 1px 2px rgba(10,10,10,0.04);
  position: relative;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.aff-tool-card:hover {
  border-color: #d4d4d4;
  box-shadow: 0 1px 2px rgba(10,10,10,0.04), 0 8px 24px -8px rgba(10,10,10,0.08);
}

/* Copy button */
.aff-copy-btn {
  padding: 9px 18px;
  border-radius: 8px;
  border: 1px solid #d4d4d4;
  background: #ffffff;
  color: #0a0a0a;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.15s ease;
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 90px;
  justify-content: center;
}
.aff-copy-btn:hover {
  border-color: #0a0a0a;
  background: #0a0a0a;
  color: #ffffff;
}
.aff-copy-btn.copied {
  background: #059669;
  border-color: #059669;
  color: #ffffff;
}

/* Date filter segmented control */
.aff-date-control {
  display: flex;
  gap: 2px;
  background: #f5f5f5;
  border-radius: 10px;
  padding: 3px;
  border: 1px solid #ececec;
}
.aff-date-btn {
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  border: none;
  outline: none;
  user-select: none;
}
.aff-date-btn.active {
  background: #ffffff;
  color: #0a0a0a;
  box-shadow: 0 1px 2px rgba(10,10,10,0.06), 0 0 0 1px #ececec;
  font-weight: 600;
}
.aff-date-btn.inactive {
  background: transparent;
  color: #737373;
}
.aff-date-btn.inactive:hover {
  color: #0a0a0a;
}

/* Table */
.aff-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}
.aff-table th {
  text-align: left;
  padding: 12px 24px;
  font-size: 11px;
  font-weight: 500;
  color: #737373;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #ececec;
  background: #fafafa;
}
.aff-table th:first-child { border-radius: 12px 0 0 0; }
.aff-table th:last-child { border-radius: 0 12px 0 0; }
.aff-table td {
  padding: 14px 24px;
  font-size: 13px;
  color: #404040;
  border-bottom: 1px solid #f5f5f5;
}
.aff-table tr:hover td { background: #fafafa; }
.aff-table tr:last-child td { border-bottom: none; }

/* Logout button */
.aff-logout-btn {
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid #ececec;
  background: transparent;
  color: #525252;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.aff-logout-btn:hover {
  border-color: #d4d4d4;
  color: #0a0a0a;
  background: #f5f5f5;
}

/* Loading skeleton */
.aff-loading {
  background: linear-gradient(90deg, #f5f5f5 25%, #ececec 50%, #f5f5f5 75%);
  background-size: 200% 100%;
  animation: aff-shimmer 1.5s infinite;
  border-radius: 14px;
  height: 140px;
}

/* Tip cards */
.aff-tip-card {
  background: #ffffff;
  border-radius: 14px;
  padding: 22px;
  border: 1px solid #ececec;
  box-shadow: 0 1px 2px rgba(10,10,10,0.04);
  transition: border-color 0.2s, box-shadow 0.2s;
  cursor: default;
  animation: aff-fade-up 0.4s ease-out both;
}
.aff-tip-card:hover {
  border-color: #d4d4d4;
  box-shadow: 0 1px 2px rgba(10,10,10,0.04), 0 8px 24px -8px rgba(10,10,10,0.08);
}

/* Badge pills */
.aff-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
}
.aff-badge-green {
  background: #ecfdf5;
  color: #047857;
  border: 1px solid #a7f3d0;
}
.aff-badge-red {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}

/* Section header (icon + title) */
.aff-section-h {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 18px;
}
.aff-section-h h3 {
  font-size: 14px;
  font-weight: 600;
  color: #0a0a0a;
  margin: 0;
  letter-spacing: -0.01em;
}
.aff-section-h .aff-section-icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: #f5f5f5;
  color: #525252;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
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
// Icon library — inline SVG, Lucide-style 1.75 stroke, currentColor
// ───────────────────────────────────────────────────────────────────
const svgProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};
const Icon = {
  Eye: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  Cart: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <circle cx="9" cy="21" r="1"/>
      <circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>
    </svg>
  ),
  Check: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <path d="m9 11 3 3L22 4"/>
    </svg>
  ),
  TrendingUp: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
      <polyline points="16 7 22 7 22 13"/>
    </svg>
  ),
  Receipt: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/>
      <path d="M16 8H8"/>
      <path d="M16 12H8"/>
      <path d="M13 16H8"/>
    </svg>
  ),
  Dollar: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <line x1="12" y1="2" x2="12" y2="22"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  Award: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <circle cx="12" cy="8" r="6"/>
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>
    </svg>
  ),
  Wallet: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
    </svg>
  ),
  Target: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="6"/>
      <circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  Split: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <line x1="6" y1="3" x2="6" y2="15"/>
      <circle cx="18" cy="6" r="3"/>
      <circle cx="6" cy="18" r="3"/>
      <path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>
  ),
  Activity: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  Link: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  ),
  Sparkles: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>
      <path d="M5 3v4"/>
      <path d="M19 17v4"/>
      <path d="M3 5h4"/>
      <path d="M17 19h4"/>
    </svg>
  ),
  Music: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M9 18V5l12-2v13"/>
      <circle cx="6" cy="18" r="3"/>
      <circle cx="18" cy="16" r="3"/>
    </svg>
  ),
  Camera: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/>
      <circle cx="12" cy="13" r="3"/>
    </svg>
  ),
  Play: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <polygon points="6 3 20 12 6 21 6 3"/>
    </svg>
  ),
  Message: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/>
    </svg>
  ),
  Globe: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>
    </svg>
  ),
  X: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...svgProps}>
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Logo: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13"/>
      <circle cx="6" cy="18" r="3"/>
      <circle cx="18" cy="16" r="3"/>
    </svg>
  )
};

// Map a UTM source label to a platform icon
const platformIconFor = (source) => {
  const m = { tiktok: Icon.Music, instagram: Icon.Camera, youtube: Icon.Play, whatsapp: Icon.Message, email: Icon.Message, facebook: Icon.Globe, twitter: Icon.Globe };
  return m[source] || Icon.Globe;
};

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
          position: 'fixed', top: 20, right: 20, zIndex: 1000,
          background: '#ffffff',
          border: '1px solid #ececec',
          borderRadius: 12,
          padding: '14px 18px',
          boxShadow: '0 0 0 1px rgba(10,10,10,0.04), 0 12px 32px -8px rgba(10,10,10,0.16), 0 4px 12px -4px rgba(10,10,10,0.06)',
          display: 'flex', alignItems: 'center', gap: 14,
          animation: 'aff-fade-up 0.3s ease-out',
          maxWidth: 360,
          fontFamily: 'Inter, -apple-system, sans-serif'
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 9,
            background: '#ecfdf5',
            color: '#059669',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0
          }}>
            <Icon.Sparkles size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 3px' }}>
              Nueva venta
            </p>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#0a0a0a', margin: 0, letterSpacing: '-0.01em' }}>
              +${(toast.commission || 0).toFixed(2)} <span style={{ fontSize: 13, color: '#737373', fontWeight: 500 }}>de comisión</span>
            </p>
          </div>
          <button
            onClick={() => setToast(null)}
            style={{
              background: 'transparent', border: 'none',
              color: '#a3a3a3', cursor: 'pointer',
              padding: 4, lineHeight: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            aria-label="Cerrar"
          ><Icon.X size={16} /></button>
        </div>
      )}
      <div className="aff-dash">

        {/* -------- HEADER -------- */}
        <header className="aff-dash-header">
          <div className="aff-dash-header-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: '#0a0a0a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#ffffff', flexShrink: 0
              }}>
                <Icon.Logo size={16} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="aff-header-brand" style={{ fontSize: 15, fontWeight: 600, color: '#0a0a0a', letterSpacing: '-0.01em' }}>RegalosQueCantan</span>
                <span className="aff-header-badge" style={{
                  fontSize: 10, fontWeight: 500, color: '#525252', letterSpacing: 0.3,
                  background: '#f5f5f5', padding: '3px 9px',
                  borderRadius: 6, border: '1px solid #ececec'
                }}>Partner Portal</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: '#0a0a0a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 600, color: '#ffffff'
                }}>
                  {firstName[0]}
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#0a0a0a', display: 'none' }} className="aff-name-desktop">{firstName}</span>
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
            marginBottom: 32, flexWrap: 'wrap', gap: 16,
            animation: 'aff-fade-up 0.4s ease-out both'
          }} className="aff-welcome-row">
            <div>
              <h2 className="aff-welcome-title" style={{ fontSize: 26, fontWeight: 600, color: '#0a0a0a', margin: '0 0 4px', letterSpacing: '-0.025em' }}>
                Bienvenido, {firstName}
              </h2>
              <p style={{ fontSize: 14, color: '#737373', margin: 0 }}>Aquí está tu resumen de actividad</p>
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
                fontSize: 11, fontWeight: 500, color: '#737373', textTransform: 'uppercase',
                letterSpacing: 0.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8
              }}>
                <Icon.Link size={14} />
                Tu link
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{
                  flex: 1, padding: '11px 14px', background: '#fafafa', borderRadius: 9,
                  border: '1px solid #ececec', fontSize: 13, color: '#404040',
                  wordBreak: 'break-all', fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace",
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
                  fontSize: 11, fontWeight: 500, color: '#737373', textTransform: 'uppercase',
                  letterSpacing: 0.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <Icon.Receipt size={14} />
                  Tu código
                </label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{
                    flex: 1, padding: '11px 14px', background: '#fafafa', borderRadius: 9,
                    border: '1px solid #ececec', fontSize: 20, fontWeight: 600,
                    color: '#0a0a0a', letterSpacing: 3,
                    fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace",
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
                gap: 14, marginBottom: 28
              }}>
                {[
                  {
                    label: 'Visitantes', value: stats.visits,
                    Icon: Icon.Eye,
                    sub: 'Clicks en tu link', delay: '0s', cls: '',
                    series: buildSparklineSeries(dailyStats, 'visits'), sparkColor: '#0a0a0a'
                  },
                  {
                    label: 'Checkouts', value: stats.checkouts,
                    Icon: Icon.Cart,
                    sub: 'Iniciaron compra', delay: '0.04s', cls: '',
                    series: buildSparklineSeries(dailyStats, 'checkouts'), sparkColor: '#0a0a0a'
                  },
                  {
                    label: 'Ventas', value: stats.totalPurchases,
                    Icon: Icon.Check,
                    sub: 'Completadas', delay: '0.08s', cls: '',
                    series: buildSparklineSeries(dailyStats, 'purchases'), sparkColor: '#0a0a0a'
                  },
                  {
                    label: 'Conversión', value: `${stats.conversionRate}%`,
                    Icon: Icon.TrendingUp,
                    sub: 'Visitantes → Ventas', delay: '0.12s', cls: ''
                  },
                  {
                    label: 'Ticket promedio', value: `$${(stats.aov || 0).toFixed(2)}`,
                    Icon: Icon.Receipt,
                    sub: 'Por venta', delay: '0.16s', cls: ''
                  },
                  {
                    label: 'Ingresos', value: `$${stats.totalRevenue.toFixed(2)}`,
                    Icon: Icon.Dollar,
                    sub: 'Total generado', delay: '0.20s', cls: '',
                    series: buildSparklineSeries(dailyStats, 'revenue'), sparkColor: '#0a0a0a'
                  },
                  {
                    label: 'Tu comisión', value: `$${stats.totalCommission.toFixed(2)}`,
                    Icon: Icon.Award,
                    sub: `${stats.commissionPct}% de ingresos`, delay: '0.24s', cls: '',
                    valueColor: '#059669',
                    series: buildSparklineSeries(dailyStats, 'commission'), sparkColor: '#059669'
                  },
                ].map((s, i) => {
                  const StatIcon = s.Icon;
                  return (
                  <div
                    key={i}
                    className={`aff-stat-card ${s.cls}`}
                    style={{ animationDelay: s.delay }}
                  >
                    <div className="aff-stat-icon">
                      <StatIcon size={16} />
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      color: '#737373',
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      display: 'block', marginBottom: 8
                    }}>
                      {s.label}
                    </span>
                    <div className="aff-stat-value aff-num" style={{
                      fontSize: 28, fontWeight: 600,
                      color: s.valueColor || '#0a0a0a',
                      letterSpacing: '-0.025em', lineHeight: 1.1, marginBottom: 4
                    }}>
                      {s.value}
                    </div>
                    <p style={{ fontSize: 12, color: '#a3a3a3', margin: 0, fontWeight: 400 }}>{s.sub}</p>
                    {s.series && (
                      <div style={{ marginTop: 12 }}>
                        <Sparkline data={s.series} color={s.sparkColor} />
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>

              {/* -------- COMMISSION SPLIT (Available / Pending / Paid) -------- */}
              <div className="aff-section-card" style={{
                marginBottom: 16,
                animation: 'aff-fade-up 0.4s ease-out 0.28s both'
              }}>
                <div className="aff-section-h">
                  <div className="aff-section-icon"><Icon.Wallet size={15} /></div>
                  <h3>Tus comisiones</h3>
                </div>
                <div className="aff-stats-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 12
                }}>
                  {[
                    {
                      label: 'Disponible', value: stats.availableCommission ?? 0,
                      sub: `Listo después del período de ${refundWindowDays} días`,
                      color: '#059669', accent: '#a7f3d0'
                    },
                    {
                      label: 'Pendiente', value: stats.pendingCommission ?? 0,
                      sub: `Dentro de ${refundWindowDays} días de la venta`,
                      color: '#d97706', accent: '#fde68a'
                    },
                    {
                      label: 'Pagado', value: stats.paidCommission ?? 0,
                      sub: 'Total enviado a tu cuenta',
                      color: '#0a0a0a', accent: '#ececec'
                    },
                  ].map((c, i) => (
                    <div key={i} style={{
                      background: '#ffffff', borderRadius: 11, padding: '16px 18px',
                      border: '1px solid #ececec',
                      borderLeft: `2px solid ${c.color}`,
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 500, color: '#737373',
                        textTransform: 'uppercase', letterSpacing: 0.5,
                        display: 'block', marginBottom: 8
                      }}>
                        {c.label}
                      </span>
                      <div className="aff-num" style={{
                        fontSize: 24, fontWeight: 600, color: c.color,
                        letterSpacing: '-0.025em', lineHeight: 1.1, marginBottom: 4
                      }}>
                        ${(Number(c.value) || 0).toFixed(2)}
                      </div>
                      <p style={{ fontSize: 11, color: '#a3a3a3', margin: 0, lineHeight: 1.4 }}>{c.sub}</p>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: '#a3a3a3', margin: '16px 0 0', textAlign: 'center' }}>
                  Las comisiones pasan de <span style={{ color: '#d97706', fontWeight: 500 }}>Pendiente</span> a <span style={{ color: '#059669', fontWeight: 500 }}>Disponible</span> automáticamente después de {refundWindowDays} días.
                </p>
              </div>

              {/* -------- WEEKLY GOAL -------- */}
              {(() => {
                const pct = Math.min(100, weeklyGoal.target > 0 ? (weeklyGoal.current / weeklyGoal.target) * 100 : 0);
                const remaining = Math.max(0, weeklyGoal.target - weeklyGoal.current);
                return (
                  <div className="aff-section-card" style={{
                    marginBottom: 16,
                    animation: 'aff-fade-up 0.4s ease-out 0.32s both'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div className="aff-section-h" style={{ margin: 0 }}>
                        <div className="aff-section-icon"><Icon.Target size={15} /></div>
                        <h3>Meta semanal</h3>
                      </div>
                      <span className="aff-num" style={{ fontSize: 13, color: '#737373', fontWeight: 500 }}>
                        <span style={{ color: '#0a0a0a', fontWeight: 600 }}>{weeklyGoal.current}</span> / {weeklyGoal.target} ventas
                      </span>
                    </div>
                    <div style={{
                      height: 6, background: '#f5f5f5', borderRadius: 6, overflow: 'hidden',
                      marginBottom: 12, border: '1px solid #ececec'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: pct >= 100 ? '#059669' : '#0a0a0a',
                        borderRadius: 6,
                        transition: 'width 0.6s ease-out'
                      }} />
                    </div>
                    <p style={{ fontSize: 12, color: '#737373', margin: 0 }}>
                      {pct >= 100
                        ? 'Meta alcanzada esta semana. Sigue así.'
                        : remaining === 1
                          ? 'Te falta 1 venta para llegar a la meta.'
                          : `Te faltan ${remaining} ventas para llegar a la meta.`
                      }
                      {weeklyGoal.lastWeek > 0 && (
                        <span style={{ marginLeft: 8, color: '#a3a3a3' }}>
                          · La semana pasada: {weeklyGoal.lastWeek} ventas
                        </span>
                      )}
                    </p>
                  </div>
                );
              })()}

              {/* -------- COUPON vs LINK BREAKDOWN -------- */}
              {(attribution.couponSales + attribution.linkSales) > 0 && (
                <div className="aff-section-card" style={{
                  marginBottom: 16,
                  animation: 'aff-fade-up 0.4s ease-out 0.36s both'
                }}>
                  <div className="aff-section-h">
                    <div className="aff-section-icon"><Icon.Split size={15} /></div>
                    <h3>Código vs Link</h3>
                  </div>
                  {(() => {
                    const total = attribution.couponSales + attribution.linkSales;
                    const couponPct = total > 0 ? (attribution.couponSales / total) * 100 : 0;
                    const linkPct = 100 - couponPct;
                    return (
                      <>
                        <div style={{
                          display: 'flex', height: 8, borderRadius: 6, overflow: 'hidden',
                          marginBottom: 16, background: '#f5f5f5', border: '1px solid #ececec'
                        }}>
                          {couponPct > 0 && <div style={{ width: `${couponPct}%`, background: '#7c3aed' }} />}
                          {linkPct > 0 && <div style={{ width: `${linkPct}%`, background: '#0a0a0a' }} />}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div style={{ background: '#ffffff', borderRadius: 11, padding: '14px 16px', border: '1px solid #ececec', borderLeft: '2px solid #7c3aed' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 500, color: '#737373', textTransform: 'uppercase', letterSpacing: 0.5 }}>Por código</span>
                            </div>
                            <div className="aff-num" style={{ fontSize: 18, fontWeight: 600, color: '#0a0a0a', letterSpacing: '-0.02em' }}>{attribution.couponSales} <span style={{ fontSize: 12, color: '#a3a3a3', fontWeight: 500 }}>ventas</span></div>
                            <div className="aff-num" style={{ fontSize: 12, color: '#737373', marginTop: 4 }}>${attribution.couponRevenue.toFixed(2)} en ingresos</div>
                          </div>
                          <div style={{ background: '#ffffff', borderRadius: 11, padding: '14px 16px', border: '1px solid #ececec', borderLeft: '2px solid #0a0a0a' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 500, color: '#737373', textTransform: 'uppercase', letterSpacing: 0.5 }}>Por link</span>
                            </div>
                            <div className="aff-num" style={{ fontSize: 18, fontWeight: 600, color: '#0a0a0a', letterSpacing: '-0.02em' }}>{attribution.linkSales} <span style={{ fontSize: 12, color: '#a3a3a3', fontWeight: 500 }}>ventas</span></div>
                            <div className="aff-num" style={{ fontSize: 12, color: '#737373', marginTop: 4 }}>${attribution.linkRevenue.toFixed(2)} en ingresos</div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* -------- PER-CHANNEL UTM BREAKDOWN -------- */}
              {utmBreakdown.length > 0 && (
                <div className="aff-section-card" style={{
                  marginBottom: 16,
                  animation: 'aff-fade-up 0.4s ease-out 0.40s both'
                }}>
                  <div className="aff-section-h">
                    <div className="aff-section-icon"><Icon.Activity size={15} /></div>
                    <h3>Por plataforma</h3>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {utmBreakdown.map((row) => {
                      const max = Math.max(...utmBreakdown.map(r => r.sales), 1);
                      const pct = (row.sales / max) * 100;
                      const PIcon = platformIconFor(row.source);
                      return (
                        <div key={row.source}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, color: '#0a0a0a', fontWeight: 500, textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: '#525252' }}><PIcon size={14} /></span>
                              {row.source}
                            </span>
                            <span className="aff-num" style={{ fontSize: 12, color: '#737373' }}>
                              <span style={{ color: '#0a0a0a', fontWeight: 500 }}>{row.sales}</span> ventas · ${row.revenue.toFixed(2)} · <span style={{ color: '#059669', fontWeight: 500 }}>${row.commission.toFixed(2)}</span>
                            </span>
                          </div>
                          <div style={{ height: 4, background: '#f5f5f5', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: '#0a0a0a', borderRadius: 4 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* -------- PER-CHANNEL LINK GENERATOR -------- */}
              <div className="aff-section-card" style={{
                marginBottom: 16,
                animation: 'aff-fade-up 0.4s ease-out 0.44s both'
              }}>
                <div className="aff-section-h" style={{ marginBottom: 6 }}>
                  <div className="aff-section-icon"><Icon.Link size={15} /></div>
                  <h3>Links por plataforma</h3>
                </div>
                <p style={{ fontSize: 12, color: '#737373', margin: '0 0 16px 38px' }}>
                  Usa un link diferente en cada red para saber cuál te genera más ventas.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { source: 'tiktok', label: 'TikTok', PIcon: Icon.Music },
                    { source: 'instagram', label: 'Instagram', PIcon: Icon.Camera },
                    { source: 'youtube', label: 'YouTube', PIcon: Icon.Play },
                    { source: 'whatsapp', label: 'WhatsApp', PIcon: Icon.Message },
                  ].map(({ source, label, PIcon }) => {
                    const link = `https://regalosquecantan.com/?ref=${affiliate.code}&utm_source=${source}`;
                    const copyKey = `link_${source}`;
                    const isCopied = copied === copyKey;
                    return (
                      <div key={source} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '11px 14px', background: '#fafafa',
                        borderRadius: 9, border: '1px solid #ececec'
                      }}>
                        <span style={{ width: 18, height: 18, color: '#525252', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PIcon size={16} /></span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#0a0a0a', minWidth: 84 }}>{label}</span>
                        <code style={{
                          flex: 1, fontSize: 12, color: '#737373',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace"
                        }}>{link}</code>
                        <button
                          onClick={() => copyToClipboard(link, copyKey)}
                          style={{
                            padding: '6px 12px',
                            background: isCopied ? '#0a0a0a' : '#ffffff',
                            color: isCopied ? '#ffffff' : '#0a0a0a',
                            border: '1px solid ' + (isCopied ? '#0a0a0a' : '#d4d4d4'),
                            borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            fontFamily: 'inherit',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {isCopied ? 'Copiado' : 'Copiar'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* -------- TRANSPARENCY BANNER -------- */}
              <div style={{
                display: 'flex', gap: 12, alignItems: 'center',
                background: '#fafafa',
                borderRadius: 11, padding: '12px 18px', marginBottom: 16,
                border: '1px solid #ececec',
                animation: 'aff-fade-up 0.4s ease-out 0.48s both'
              }} className="aff-transparency-bar">
                <div style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#ffffff',
                  border: '1px solid #ececec',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#525252', flexShrink: 0
                }}>
                  <Icon.Eye size={14} />
                </div>
                <p style={{ fontSize: 13, color: '#525252', margin: 0, lineHeight: 1.5 }}>
                  <span style={{ color: '#0a0a0a', fontWeight: 500 }}>Transparencia total</span> — Datos actualizados en tiempo real. Ves exactamente lo que generan tu link y tu código.
                </p>
              </div>

              {/* -------- RECENT ACTIVITY TABLE -------- */}
              <div className="aff-section-card" style={{
                padding: 0,
                overflow: 'hidden',
                animation: 'aff-fade-up 0.4s ease-out 0.52s both',
                marginBottom: 16
              }}>
                <div style={{
                  padding: '20px 24px 16px',
                  display: 'flex', alignItems: 'center', gap: 10
                }}>
                  <div className="aff-section-icon"><Icon.Activity size={15} /></div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0a0a0a', margin: 0, letterSpacing: '-0.01em' }}>Actividad reciente</h3>
                </div>
                {recentPurchases.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="aff-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Tipo</th>
                          <th>Monto</th>
                          <th>Tu comisión</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentPurchases.map((p, i) => (
                          <tr key={i}>
                            <td className="aff-num">
                              {new Date(p.date).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td>
                              {p.type === 'refund' ? (
                                <span className="aff-badge aff-badge-red">Reembolso</span>
                              ) : (
                                <span className="aff-badge aff-badge-green">Venta</span>
                              )}
                            </td>
                            <td className="aff-num" style={{
                              color: p.type === 'refund' ? '#b91c1c' : '#0a0a0a',
                              fontWeight: 500
                            }}>
                              {p.type === 'refund' ? `-$${Math.abs(p.amount).toFixed(2)}` : `$${p.amount.toFixed(2)}`}
                            </td>
                            <td className="aff-num" style={{
                              color: p.type === 'refund' ? '#b91c1c' : '#059669',
                              fontWeight: 600
                            }}>
                              {p.type === 'refund' ? `-$${Math.abs(p.commission).toFixed(2)}` : `+$${p.commission.toFixed(2)}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px 24px 48px' }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 11,
                      background: '#fafafa', border: '1px solid #ececec',
                      color: '#a3a3a3',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto 16px'
                    }}>
                      <Icon.Activity size={20} />
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#0a0a0a', margin: '0 0 6px' }}>Aún no hay ventas</p>
                    <p style={{ fontSize: 13, color: '#737373', margin: 0, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                      Comparte tu link o código con tu audiencia para empezar a generar comisiones.
                    </p>
                  </div>
                )}
              </div>

              {/* -------- PAYOUT HISTORY -------- */}
              <div className="aff-section-card" style={{
                padding: 0,
                overflow: 'hidden',
                animation: 'aff-fade-up 0.4s ease-out 0.56s both',
                marginBottom: 16
              }}>
                <div style={{
                  padding: '20px 24px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  flexWrap: 'wrap', gap: 12,
                  borderBottom: '1px solid #f5f5f5'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <div className="aff-section-icon"><Icon.Wallet size={15} /></div>
                      <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0a0a0a', margin: 0, letterSpacing: '-0.01em' }}>Historial de pagos</h3>
                    </div>
                    <p style={{ fontSize: 12, color: '#737373', margin: 0, paddingLeft: 38 }}>Pagos mensuales vía Zelle, Venmo o PayPal</p>
                  </div>
                  <div style={{
                    padding: '6px 12px', borderRadius: 7,
                    background: '#fafafa', border: '1px solid #ececec'
                  }}>
                    <span className="aff-num" style={{ fontSize: 12, fontWeight: 500, color: '#0a0a0a' }}>
                      Pendiente: ${stats.totalCommission.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div style={{ padding: '24px' }}>
                  <div style={{
                    background: '#fafafa', borderRadius: 11,
                    border: '1px solid #ececec', padding: '32px 24px',
                    textAlign: 'center'
                  }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 11,
                      background: '#ffffff', border: '1px solid #ececec',
                      color: '#a3a3a3',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto 14px'
                    }}>
                      <Icon.Wallet size={20} />
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#0a0a0a', margin: '0 0 6px' }}>Aún no hay pagos registrados</p>
                    <p style={{
                      fontSize: 12, color: '#737373', margin: 0, maxWidth: 380,
                      marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6
                    }}>
                      Los pagos se procesan mensualmente. Cuando alcances el mínimo de <span style={{ color: '#0a0a0a', fontWeight: 500 }}>$20 USD</span>, recibirás tu primer pago.
                    </p>
                  </div>
                </div>
              </div>

              {/* -------- PROMOTION TIPS -------- */}
              <div style={{ marginBottom: 16, animation: 'aff-fade-up 0.4s ease-out 0.60s both' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div className="aff-section-icon"><Icon.Sparkles size={15} /></div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0a0a0a', margin: 0, letterSpacing: '-0.01em' }}>Ideas para promover</h3>
                </div>
                <div className="aff-tips-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                  gap: 12
                }}>
                  {[
                    { Icon: Icon.Play, title: 'Graba la reacción', desc: 'Filma a alguien recibiendo su canción personalizada. Los videos de reacción son el contenido que más convierte.', tag: 'TikTok / Reels', delay: '0.62s' },
                    { Icon: Icon.Link, title: 'Link en tu bio', desc: 'Agrega tu link de afiliado a tu bio de Instagram, TikTok o YouTube. Tráfico pasivo 24/7.', tag: 'Todas las redes', delay: '0.66s' },
                    { Icon: Icon.Message, title: 'Cuenta una historia', desc: '"Le regalé una canción a mi mamá y lloró de felicidad" — las historias personales venden más que cualquier anuncio.', tag: 'Stories / Posts', delay: '0.70s' },
                    { Icon: Icon.Target, title: 'Fechas especiales', desc: 'Antes del Día de las Madres, San Valentín, cumpleaños... recuerda a tu audiencia que este es el regalo perfecto.', tag: 'Contenido estacional', delay: '0.74s' },
                    { Icon: Icon.Receipt, title: 'Comparte tu código', desc: 'Menciona tu código de descuento en tus videos: "Usen mi código [TU_CODIGO] para un descuento especial."', tag: 'Videos / Lives', delay: '0.78s' },
                    { Icon: Icon.Music, title: 'Reproduce la canción', desc: 'Pon una canción de ejemplo en tu story o video. Que tu audiencia escuche la calidad. El producto se vende solo.', tag: 'Audio / Video', delay: '0.82s' },
                  ].map((tip, i) => {
                    const TIcon = tip.Icon;
                    return (
                    <div key={i} className="aff-tip-card" style={{ animationDelay: tip.delay }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 9,
                          background: '#fafafa', border: '1px solid #ececec',
                          color: '#525252',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          <TIcon size={16} />
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 500, color: '#737373',
                          textTransform: 'uppercase', letterSpacing: 0.5,
                          padding: '4px 10px', background: '#fafafa',
                          borderRadius: 6, border: '1px solid #ececec'
                        }}>
                          {tip.tag}
                        </span>
                      </div>
                      <h4 style={{ fontSize: 14, fontWeight: 600, color: '#0a0a0a', margin: '0 0 6px', letterSpacing: '-0.01em' }}>{tip.title}</h4>
                      <p style={{ fontSize: 13, color: '#737373', margin: 0, lineHeight: 1.6 }}>{tip.desc}</p>
                    </div>
                  );
                  })}
                </div>
              </div>

              {/* -------- SAMPLE SCRIPT -------- */}
              <div className="aff-section-card" style={{
                animation: 'aff-fade-up 0.4s ease-out 0.86s both',
              }}>
                <div className="aff-section-h">
                  <div className="aff-section-icon"><Icon.Message size={15} /></div>
                  <h3>Guión de ejemplo para tu contenido</h3>
                </div>
                <div style={{
                  background: '#fafafa', borderRadius: 11,
                  padding: '20px 24px', border: '1px solid #ececec'
                }}>
                  <p style={{
                    fontSize: 14, color: '#404040', margin: 0, lineHeight: 1.8,
                  }}>
                    "¿Quieres darle a alguien un regalo que NUNCA va a olvidar? Imagínate regalarle una canción con SU nombre, contando SU historia, en el género que más le gusta — corrido, cumbia, bachata, lo que quieras. Así funciona RegalosQueCantan. Tú eliges todo, y en minutos tienes una canción única que no existe en ningún otro lugar del mundo. Usa mi código <span style={{ color: '#0a0a0a', fontWeight: 600, background: '#ffffff', padding: '2px 8px', borderRadius: 5, border: '1px solid #ececec', fontFamily: "'SF Mono', 'Menlo', monospace", fontSize: 13 }}>{affiliate.coupon_code || '[TU_CODIGO]'}</span> para un descuento especial. El link está en mi bio."
                  </p>
                </div>
                <p style={{
                  fontSize: 12, color: '#a3a3a3', margin: '14px 0 0',
                  textAlign: 'center'
                }}>
                  Adáptalo a tu estilo — lo importante es que sea auténtico y tuyo.
                </p>
              </div>
            </>
          ) : null}

          {/* -------- FLOATING SUPPORT BUTTON -------- */}
          <a
            href="https://wa.me/12136666619?text=Hola%2C%20soy%20afiliado%20de%20RegalosQueCantan%20y%20tengo%20una%20pregunta"
            target="_blank"
            rel="noopener noreferrer"
            className="aff-support-btn"
            style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 50, background: '#0a0a0a', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 500, boxShadow: '0 0 0 1px rgba(10,10,10,0.04), 0 12px 32px -8px rgba(10,10,10,0.24)', transition: 'transform 0.15s, box-shadow 0.15s', zIndex: 50, fontFamily: 'inherit' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <Icon.Message size={15} />
            ¿Necesitas ayuda?
          </a>
        </main>
      </div>
    </>
  );
}
