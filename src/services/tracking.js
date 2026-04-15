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

// Store UTM params on first visit
const storeUtmParams = () => {
  const stored = sessionStorage.getItem('rqc_utm_params');
  if (!stored) {
    const utm = getUtmParams();
    if (utm.utm_source || utm.utm_medium || utm.utm_campaign) {
      sessionStorage.setItem('rqc_utm_params', JSON.stringify(utm));
    }
    // Store email campaign attribution
    if (utm.utm_source === 'email' && utm.utm_campaign) {
      sessionStorage.setItem('rqc_from_email', utm.utm_campaign);
    }
  }
};

/**
 * Capture affiliate ref code from URL (?ref=code) and persist it to sessionStorage.
 * Logs a single visit event to affiliate_events the first time we see the code in this session.
 * Safe to call on every page load — dedupes via sessionStorage flags.
 */
export const captureAffiliateRef = async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const refFromUrl = (params.get('ref') || '').toLowerCase().trim();

    // Update stored code if URL has a fresh one (last-touch attribution)
    if (refFromUrl) {
      const previous = sessionStorage.getItem('rqc_affiliate');
      if (previous !== refFromUrl) {
        sessionStorage.setItem('rqc_affiliate', refFromUrl);
        // New affiliate this session — clear the visit-logged flag so we log it
        sessionStorage.removeItem('rqc_affiliate_visit_logged');
      }
    }

    const affiliateCode = sessionStorage.getItem('rqc_affiliate');
    if (!affiliateCode) return;

    // Only log one visit per session per affiliate code
    if (sessionStorage.getItem('rqc_affiliate_visit_logged') === affiliateCode) return;

    // Optimistically mark as logged so we don't double-fire on re-renders
    sessionStorage.setItem('rqc_affiliate_visit_logged', affiliateCode);

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
      sessionStorage.removeItem('rqc_affiliate');
      sessionStorage.removeItem('rqc_affiliate_visit_logged');
    } else if (!res.ok) {
      // Network/server error — allow retry next page load
      sessionStorage.removeItem('rqc_affiliate_visit_logged');
    }
  } catch (err) {
    // Never block the app on tracking failures, but allow retry next time
    sessionStorage.removeItem('rqc_affiliate_visit_logged');
    if (import.meta.env.DEV) console.warn('Affiliate visit tracking failed:', err);
  }
};

// Get stored UTM params
const getStoredUtmParams = () => {
  try {
    const stored = sessionStorage.getItem('rqc_utm_params');
    return stored ? JSON.parse(stored) : getUtmParams();
  } catch {
    return getUtmParams();
  }
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
    
    const sessionId = getSessionId();
    const utmParams = getStoredUtmParams();
    
    // ========== META PIXEL TRACKING ==========
    if (window.fbq) {
      // Map steps to Meta Pixel events
      const pixelEventMap = {
        'landing': { event: 'ViewContent', params: { content_name: 'Landing Page', content_category: 'funnel' }},
        'landing_v2': { event: 'ViewContent', params: { content_name: 'Landing Page V2', content_category: 'funnel' }},
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
  captureAffiliateRef
};
