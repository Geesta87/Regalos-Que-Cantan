// src/services/tracking.js
// Funnel Analytics Tracking for RegalosQueCantan

import { supabase } from './api';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6YnZhanVuZ3NocWNwdXNmaWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5NDM3MjAsImV4cCI6MjA4NDUxOTcyMH0.9cu9re38_Np3Q6xEcjGdEwctSiPAaaqo8W2c3HEx6k4';

// Generate or retrieve session ID
const getSessionId = () => {
  let sessionId = sessionStorage.getItem('rqc_session_id');
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    sessionStorage.setItem('rqc_session_id', sessionId);
  }
  return sessionId;
};

// Get UTM params from URL
const getUtmParams = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || null,
    utm_medium: params.get('utm_medium') || null,
    utm_campaign: params.get('utm_campaign') || null
  };
};

// Detect device type
const getDeviceType = () => {
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
};

// Persist UTM params across the WHOLE funnel. Stored in localStorage with a
// 30-day TTL (not sessionStorage) so attribution survives tab closes, new tabs,
// payment completing later, and email-link round trips — the exact fix the
// affiliate ?ref= code already got. Without this, ~65% of paid orders saved with
// NO campaign tag because sessionStorage was empty by the time the order was made.
const UTM_TTL_DAYS = 30;
const UTM_KEY = 'rqc_utm';

const setStoredUtm = (utm) => {
  try {
    localStorage.setItem(UTM_KEY, JSON.stringify({
      utm_source: utm.utm_source || null,
      utm_medium: utm.utm_medium || null,
      utm_campaign: utm.utm_campaign || null,
      from_email: (utm.utm_source === 'email' && utm.utm_campaign) ? utm.utm_campaign : null,
      expiresAt: Date.now() + UTM_TTL_DAYS * 24 * 60 * 60 * 1000,
    }));
  } catch { /* storage full / disabled — fall back to sessionStorage below */ }
};

// Store UTM params. Last-touch: a fresh UTM on the URL refreshes the stored value
// + the 30-day window (consistent with how the affiliate ?ref= is handled).
const storeUtmParams = () => {
  const utm = getUtmParams();
  if (utm.utm_source || utm.utm_medium || utm.utm_campaign) {
    setStoredUtm(utm);
    // Keep the legacy sessionStorage keys in sync for any older reader.
    try {
      sessionStorage.setItem('rqc_utm_params', JSON.stringify(utm));
      if (utm.utm_source === 'email' && utm.utm_campaign) sessionStorage.setItem('rqc_from_email', utm.utm_campaign);
    } catch { /* ignore */ }
  }
};

// ─── Meta click-ID (fbc) capture ────────────────────────────────────────────
// The Meta pixel only writes the _fbc cookie when it loads with ?fbclid= in the
// URL, and that cookie can be missing by the time checkout runs — which left the
// server-side (CAPI) Purchase sending an EMPTY fbc, capping Event Match Quality.
// We capture fbclid on landing, build the canonical fbc value (fb.1.<ts>.<fbclid>)
// and persist it 90 days so createCheckout can always attach it to the order.
const FBC_KEY = 'rqc_fbc';
const FBC_TTL_DAYS = 90;

const captureFbc = () => {
  try {
    const fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (!fbclid) return;
    // Only (re)build when a NEW click arrives, so the timestamp reflects the click.
    const prev = JSON.parse(localStorage.getItem(FBC_KEY) || 'null');
    if (prev && prev.fbclid === fbclid && prev.expiresAt > Date.now()) return;
    localStorage.setItem(FBC_KEY, JSON.stringify({
      fbc: `fb.1.${Date.now()}.${fbclid}`,
      fbclid,
      expiresAt: Date.now() + FBC_TTL_DAYS * 24 * 60 * 60 * 1000,
    }));
  } catch { /* storage disabled — cookie path still works */ }
};

// Best available fbc: prefer the live _fbc cookie, else our persisted value.
export const getStoredFbc = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(FBC_KEY) || 'null');
    if (raw && raw.fbc && raw.expiresAt > Date.now()) return raw.fbc;
  } catch { /* ignore */ }
  return '';
};

// ─── TikTok click-ID (ttclid) capture ───────────────────────────────────────
// TikTok's equivalent of fbclid. It lands on the URL (?ttclid=...) when a user
// clicks a TikTok ad, and is what the server-side Events API needs to attribute
// a Purchase back to the exact ad/click. Almost all TikTok traffic arrives in
// TikTok's in-app browser where cookies/pixel are flaky, so we persist ttclid
// on landing (30 days) and attach it at checkout — otherwise the server-side
// CompletePayment goes out with no click-ID and TikTok can't match the sale.
const TTCLID_KEY = 'rqc_ttclid';
const TTCLID_TTL_DAYS = 30;

const captureTtclid = () => {
  try {
    const ttclid = new URLSearchParams(window.location.search).get('ttclid');
    if (!ttclid) return;
    const prev = JSON.parse(localStorage.getItem(TTCLID_KEY) || 'null');
    // A fresh click always wins (last-touch) and resets the 30-day window.
    if (prev && prev.ttclid === ttclid && prev.expiresAt > Date.now()) return;
    localStorage.setItem(TTCLID_KEY, JSON.stringify({
      ttclid,
      expiresAt: Date.now() + TTCLID_TTL_DAYS * 24 * 60 * 60 * 1000,
    }));
  } catch { /* storage disabled — the _ttp cookie path still works */ }
};

// Best available ttclid: our persisted landing value (TikTok has no live cookie
// equivalent that survives the in-app browser reliably).
export const getStoredTtclid = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(TTCLID_KEY) || 'null');
    if (raw && raw.ttclid && raw.expiresAt > Date.now()) return raw.ttclid;
  } catch { /* ignore */ }
  return '';
};

// ─── Affiliate attribution storage ─────────────────────────────────────────
// Affiliate codes persist across browser sessions for 30 days. Previously
// stored in sessionStorage, which lost attribution the moment a buyer closed
// the tab — partners were losing commission on every delayed conversion.
// Now stored in localStorage as { code, expiresAt } so the attribution
// survives tab closes, browser restarts, and email-link round trips.
const AFFILIATE_TTL_DAYS = 30;
const AFFILIATE_STORAGE_KEY = 'rqc_affiliate';
const AFFILIATE_VISIT_FLAG_KEY = 'rqc_affiliate_visit_logged';

/**
 * Read the stored affiliate code, honoring the 30-day TTL. Also migrates
 * legacy sessionStorage values and pre-TTL plain-string localStorage values
 * so the rollout doesn't drop attribution for anyone mid-funnel.
 * Returns the lowercase code or null.
 */
export const getStoredAffiliateCode = () => {
  try {
    const raw = localStorage.getItem(AFFILIATE_STORAGE_KEY);
    if (raw) {
      // New format: JSON { code, expiresAt }
      if (raw.startsWith('{')) {
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj.code === 'string' && typeof obj.expiresAt === 'number') {
            if (Date.now() < obj.expiresAt) return obj.code.toLowerCase();
            // Expired — drop it
            localStorage.removeItem(AFFILIATE_STORAGE_KEY);
            localStorage.removeItem(AFFILIATE_VISIT_FLAG_KEY);
            return null;
          }
        } catch { /* fall through to legacy handling */ }
      }
      // Legacy: raw string (the code itself, no expiry). Re-wrap with TTL.
      const legacy = raw.toLowerCase().trim();
      if (/^[a-z0-9_-]+$/.test(legacy)) {
        setStoredAffiliateCode(legacy);
        return legacy;
      }
    }
  } catch { /* ignore */ }

  // One-time migration from the old sessionStorage location so anyone mid-
  // visit during the rollout keeps their attribution.
  try {
    const legacy = sessionStorage.getItem(AFFILIATE_STORAGE_KEY);
    if (legacy) {
      const code = legacy.toLowerCase().trim();
      sessionStorage.removeItem(AFFILIATE_STORAGE_KEY);
      if (/^[a-z0-9_-]+$/.test(code)) {
        setStoredAffiliateCode(code);
        return code;
      }
    }
  } catch { /* ignore */ }

  return null;
};

const setStoredAffiliateCode = (code) => {
  try {
    localStorage.setItem(AFFILIATE_STORAGE_KEY, JSON.stringify({
      code: code.toLowerCase(),
      expiresAt: Date.now() + AFFILIATE_TTL_DAYS * 24 * 60 * 60 * 1000,
    }));
  } catch { /* storage full / disabled */ }
};

const clearStoredAffiliateCode = () => {
  try {
    localStorage.removeItem(AFFILIATE_STORAGE_KEY);
    localStorage.removeItem(AFFILIATE_VISIT_FLAG_KEY);
    sessionStorage.removeItem(AFFILIATE_STORAGE_KEY);
  } catch { /* ignore */ }
};

/**
 * Capture affiliate ref code from URL (?ref=code) and persist it for 30 days.
 * Logs a single visit event to affiliate_events the first time we see the
 * code per browser per 30-day window. Safe to call on every page load.
 */
export const captureAffiliateRef = async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const refFromUrl = (params.get('ref') || '').toLowerCase().trim();

    // Update stored code if URL has a fresh one (last-touch attribution).
    // A new ?ref= always wins and resets the 30-day window.
    if (refFromUrl) {
      const previous = getStoredAffiliateCode();
      if (previous !== refFromUrl) {
        setStoredAffiliateCode(refFromUrl);
        // New affiliate this window — clear the visit-logged flag so we log it
        try { localStorage.removeItem(AFFILIATE_VISIT_FLAG_KEY); } catch { /* ignore */ }
      }
    }

    const affiliateCode = getStoredAffiliateCode();
    if (!affiliateCode) return;

    // Log at most one visit per browser per affiliate code in the 30-day
    // window. Flag stored in localStorage so a refresh / second tab doesn't
    // double-count, but flag is cleared when the code changes (above).
    if (localStorage.getItem(AFFILIATE_VISIT_FLAG_KEY) === affiliateCode) return;

    // Optimistically mark as logged so we don't double-fire on re-renders
    try { localStorage.setItem(AFFILIATE_VISIT_FLAG_KEY, affiliateCode); } catch { /* ignore */ }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/log-affiliate-visit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ affiliateCode })
    });

    // If the code is invalid, drop it so we don't keep sending bad attribution
    if (res.status === 404) {
      clearStoredAffiliateCode();
    } else if (!res.ok) {
      // Network/server error — allow retry next page load
      try { localStorage.removeItem(AFFILIATE_VISIT_FLAG_KEY); } catch { /* ignore */ }
    }
  } catch (err) {
    // Never block the app on tracking failures, but allow retry next time
    try { localStorage.removeItem(AFFILIATE_VISIT_FLAG_KEY); } catch { /* ignore */ }
    if (import.meta.env.DEV) console.warn('Affiliate visit tracking failed:', err);
  }
};

/**
 * Log that a song was successfully created under the stored affiliate code.
 * Fire-and-forget: never blocks or throws into the generation flow. The server
 * dedupes per (affiliate_code, song_id), so calling this once per created song
 * is safe even if the page re-renders. No-op when there's no affiliate stored
 * (the vast majority of organic creators).
 */
export const logAffiliateSongCreated = async (songId) => {
  try {
    const affiliateCode = getStoredAffiliateCode();
    if (!affiliateCode || !songId) return;
    await fetch(`${SUPABASE_URL}/functions/v1/log-affiliate-visit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ affiliateCode, eventType: 'song_created', songId })
    });
  } catch (err) {
    // Tracking must never break song generation.
    if (import.meta.env.DEV) console.warn('Affiliate song_created tracking failed:', err);
  }
};

// Read persisted UTM params: localStorage (30-day TTL) → legacy sessionStorage →
// current URL. Exported so the order/checkout call attaches the same value.
export const getStoredUtmParams = () => {
  try {
    const raw = localStorage.getItem(UTM_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o.expiresAt === 'number') {
        if (Date.now() < o.expiresAt) return { utm_source: o.utm_source || null, utm_medium: o.utm_medium || null, utm_campaign: o.utm_campaign || null, from_email: o.from_email || null };
        localStorage.removeItem(UTM_KEY); // expired
      }
    }
  } catch { /* ignore */ }
  try {
    const s = sessionStorage.getItem('rqc_utm_params');
    if (s) { const o = JSON.parse(s); return { utm_source: o.utm_source || null, utm_medium: o.utm_medium || null, utm_campaign: o.utm_campaign || null, from_email: sessionStorage.getItem('rqc_from_email') || null }; }
  } catch { /* ignore */ }
  const u = getUtmParams();
  return { utm_source: u.utm_source, utm_medium: u.utm_medium, utm_campaign: u.utm_campaign, from_email: (u.utm_source === 'email' && u.utm_campaign) ? u.utm_campaign : null };
};

/**
 * Track a funnel step
 * @param {string} step - Step name (landing, genre, artist, occasion, names, details, email, generating, preview, comparison, purchase)
 * @param {object} metadata - Optional additional data
 */
export const trackStep = async (step, metadata = {}) => {
  try {
    // Store UTM params on first tracking call
    storeUtmParams();
    captureFbc();
    captureTtclid();

    const sessionId = getSessionId();
    const utmParams = getStoredUtmParams();
    
    // ========== META PIXEL TRACKING ==========
    if (window.fbq) {
      // Map steps to Meta Pixel events
      const pixelEventMap = {
        'landing': { event: 'ViewContent', params: { content_name: 'Landing Page', content_category: 'funnel' }},
        'landing_v2': { event: 'ViewContent', params: { content_name: 'Landing Page V2', content_category: 'funnel' }},
        'landing_bachata': { event: 'ViewContent', params: { content_name: 'Bachata Landing', content_category: 'funnel' }},
        'genre': { event: 'ViewContent', params: { content_name: 'Genre Selection', content_category: 'funnel' }},
        'artist': { event: 'ViewContent', params: { content_name: 'Artist Selection', content_category: 'funnel' }},
        'occasion': { event: 'ViewContent', params: { content_name: 'Occasion Selection', content_category: 'funnel' }},
        'names': { event: 'ViewContent', params: { content_name: 'Names Input', content_category: 'funnel' }},
        'details': { event: 'ViewContent', params: { content_name: 'Details Input', content_category: 'funnel' }},
        'email': { event: 'Lead', params: { content_name: 'Email Captured', content_category: 'funnel' }},
        'generating': { event: 'ViewContent', params: { content_name: 'Song Generating', content_category: 'funnel' }},
        'preview': { event: 'ViewContent', params: { content_name: 'Song Preview', content_category: 'product', content_type: 'product' }},
        'comparison': { event: 'ViewContent', params: { content_name: 'Song Comparison', content_category: 'product', content_type: 'product' }},
        'song_selected': { event: 'AddToCart', params: { content_name: 'Song Selected', currency: 'USD', value: metadata.value || 29.99 }},
        'checkout_clicked': { event: 'InitiateCheckout', params: { content_name: 'Checkout Started', currency: 'USD', value: metadata.value || 29.99, num_items: metadata.num_items || 1 }}
        // Purchase event is fired directly on SuccessPage after Stripe confirms payment
      };
      
      const pixelData = pixelEventMap[step];
      if (pixelData) {
        window.fbq('track', pixelData.event, {
          ...pixelData.params,
          ...metadata
        });
        console.log(`[Meta Pixel] ${pixelData.event}:`, step);
      } else {
        // Custom event for unmapped steps
        window.fbq('trackCustom', 'FunnelStep', { step: step, ...metadata });
      }
    }
    // ========== END META PIXEL ==========

    // ========== TIKTOK PIXEL TRACKING ==========
    if (window.ttq) {
      const ttEventMap = {
        'landing': 'ViewContent',
        'landing_v2': 'ViewContent',
        'landing_premium': 'ViewContent',
        'landing_bachata': 'ViewContent',
        'genre': 'ViewContent',
        'artist': 'ViewContent',
        'occasion': 'ViewContent',
        'names': 'ViewContent',
        'details': 'ViewContent',
        'email': 'SubmitForm',
        'generating': 'ViewContent',
        'preview': 'ViewContent',
        'comparison': 'ViewContent',
        'song_selected': 'AddToCart',
        'checkout_clicked': 'InitiateCheckout'
        // CompletePayment is fired directly on SuccessPage after Stripe confirms payment
      };
      const ttEvent = ttEventMap[step];
      if (ttEvent) {
        window.ttq.track(ttEvent, {
          content_type: 'product',
          content_id: metadata.song_id || 'cancion-personalizada',
          content_name: `Canción Personalizada - ${step}`,
          quantity: metadata.num_items || 1,
          value: metadata.value || 29.99,
          currency: 'USD'
        });
        console.log(`[TikTok Pixel] ${ttEvent}:`, step);
      }
    }
    // ========== END TIKTOK PIXEL ==========

    const eventData = {
      session_id: sessionId,
      step: step,
      metadata: metadata,
      utm_source: utmParams.utm_source,
      utm_medium: utmParams.utm_medium,
      utm_campaign: utmParams.utm_campaign,
      device_type: getDeviceType(),
      user_agent: navigator.userAgent.substring(0, 500) // Limit length
    };

    // Fire and forget - don't block the UI
    const { error } = await supabase
      .from('funnel_events')
      .insert([eventData]);

    if (error && import.meta.env.DEV) {
      console.warn('Tracking error:', error);
    }
  } catch (err) {
    // Silently fail - tracking should never break the app
    if (import.meta.env.DEV) {
      console.warn('Tracking failed:', err);
    }
  }
};

/**
 * Track with additional event properties (for purchases)
 */
export const trackPurchase = async (songId, amount, couponCode = null) => {
  return trackStep('purchase', {
    song_id: songId,
    amount: amount,
    coupon_code: couponCode
  });
};

// Funnel step order for proper visualization
export const FUNNEL_STEPS = [
  { key: 'landing', label: 'Landing', icon: '🏠' },
  { key: 'landing_v2', label: 'Landing V2', icon: '🏠' },
  { key: 'landing_bachata', label: 'Bachata Landing', icon: '🌹' },
  { key: 'genre', label: 'Género', icon: '🎵' },
  { key: 'artist', label: 'Artista', icon: '🎤' },
  { key: 'occasion', label: 'Ocasión', icon: '🎁' },
  { key: 'names', label: 'Nombres', icon: '👤' },
  { key: 'details', label: 'Detalles', icon: '📝' },
  { key: 'email', label: 'Email', icon: '📧' },
  { key: 'generating', label: 'Generando', icon: '⏳' },
  { key: 'preview', label: 'Preview', icon: '🎧' },
  { key: 'comparison', label: 'Comparación', icon: '⚖️' },
  { key: 'purchase', label: 'Compra', icon: '💰' }
];

export default {
  trackStep,
  trackPurchase,
  FUNNEL_STEPS,
  getSessionId,
  captureAffiliateRef,
  getStoredAffiliateCode
};
