// RegalosQueCantan Service Worker
// ✅ IMPORTANT: Bump this version string on every deploy to bust old caches
const CACHE_VERSION = 'rqc-v2.0.3';
const CACHE_NAME = `rqc-static-${CACHE_VERSION}`;

// Only cache fonts and the shell - NOT JS bundles (Vite hashes those already)
const STATIC_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap'
];

// Install - cache fonts only, skip waiting immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.log('[SW] Install cache error:', err))
  );
});

// Activate - delete ALL old caches, claim clients immediately
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - NETWORK FIRST for everything
// This ensures new deploys are always served immediately
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip API calls, Supabase, Stripe, SendGrid, analytics
  if (url.hostname.includes('supabase')) return;
  if (url.hostname.includes('stripe')) return;
  if (url.hostname.includes('sendgrid')) return;
  if (url.hostname.includes('facebook')) return;
  if (url.hostname.includes('clarity')) return;
  if (url.hostname.includes('google-analytics')) return;
  if (!url.protocol.startsWith('http')) return;

  // For HTML navigation requests - ALWAYS network first
  // This is critical: ensures /comparison, /success etc. always get fresh index.html
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a copy for offline fallback
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          // Offline: try cache, then fall back to cached root
          return caches.match(request)
            .then((cached) => cached || caches.match('/'));
        })
    );
    return;
  }

  // For fonts (Google Fonts) - cache first (they never change)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // For JS/CSS bundles (Vite adds hashes, so new deploys = new URLs automatically)
  // Network first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

console.log('[SW] RegalosQueCantan service worker loaded');
