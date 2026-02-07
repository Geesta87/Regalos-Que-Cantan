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
