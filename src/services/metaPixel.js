// src/services/metaPixel.js
// Meta Pixel Event Tracking for Facebook Ads

/**
 * Safe fbq wrapper - only fires if pixel is loaded
 */
const fbq = (...args) => {
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq(...args);
  }
};

/**
 * Track page view
 * Call this on route changes or page loads
 */
export const trackPageView = () => {
  fbq('track', 'PageView');
};

/**
 * Track when user views content (landing page)
 */
export const trackViewContent = (contentName = 'Landing Page') => {
  fbq('track', 'ViewContent', {
    content_name: contentName
  });
};

/**
 * Track when user adds to cart (completes details step)
 * Shows high purchase intent
 */
export const trackAddToCart = (genre, occasion, recipientName) => {
  fbq('track', 'AddToCart', {
    content_type: 'product',
    content_name: `Canción Personalizada - ${genre}`,
    content_category: occasion,
    value: 19.99,
    currency: 'USD'
  });
};

/**
 * Track when user initiates checkout (submits email / confirms)
 */
export const trackInitiateCheckout = (value = 19.99, numItems = 1) => {
  fbq('track', 'InitiateCheckout', {
    value: value,
    currency: 'USD',
    num_items: numItems
  });
};

/**
 * Track lead capture (when user submits email)
 */
export const trackLead = () => {
  fbq('track', 'Lead', {
    content_name: 'Song Creation Started'
  });
};

/**
 * Track successful purchase
 * THIS IS THE MOST IMPORTANT EVENT FOR FB ADS OPTIMIZATION
 */
export const trackPurchase = (songId, amount, couponCode = null) => {
  const eventData = {
    value: parseFloat(amount) || 19.99,
    currency: 'USD',
    content_type: 'product',
    content_ids: Array.isArray(songId) ? songId : [songId],
    content_name: 'Canción Personalizada'
  };

  if (couponCode) {
    eventData.coupon = couponCode;
  }

  fbq('track', 'Purchase', eventData);
};

/**
 * Track custom events
 */
export const trackCustomEvent = (eventName, data = {}) => {
  fbq('trackCustom', eventName, data);
};

/**
 * Track when user completes song generation (shows engagement)
 */
export const trackCompleteRegistration = () => {
  fbq('track', 'CompleteRegistration', {
    content_name: 'Song Generated'
  });
};

export default {
  trackPageView,
  trackViewContent,
  trackAddToCart,
  trackInitiateCheckout,
  trackLead,
  trackPurchase,
  trackCustomEvent,
  trackCompleteRegistration
};
