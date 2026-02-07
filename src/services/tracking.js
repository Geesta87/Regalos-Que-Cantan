// src/services/tracking.js
// Funnel Analytics Tracking for RegalosQueCantan

import { supabase } from './api';

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
        'generating': { event: 'InitiateCheckout', params: { content_name: 'Song Generating', currency: 'USD', value: 19.99 }},
        'preview': { event: 'ViewContent', params: { content_name: 'Song Preview', content_category: 'product', content_type: 'product' }},
        'comparison': { event: 'AddToCart', params: { content_name: 'Song Comparison', currency: 'USD', value: 19.99 }},
        'purchase': { event: 'Purchase', params: { content_name: 'Song Purchase', currency: 'USD', value: metadata.amount || 19.99 }}
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
  getSessionId
};
