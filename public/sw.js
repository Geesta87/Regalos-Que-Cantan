// RegalosQueCantan Service Worker
// ✅ IMPORTANT: Bump this version string on every deploy to bust old caches
const CACHE_VERSION = 'rqc-v2.0.4';
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
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // ===== BYPASS LIST - let these go straight to network, SW does NOT touch them =====
  if (url.hostname.includes('supabase')) return;
  if (url.hostname.includes('stripe')) return;
  if (url.hostname.includes('sendgrid')) return;
  if (url.hostname.includes('facebook')) return;
  if (url.hostname.includes('fbcdn')) return;
  if (url.hostname.includes('clarity')) return;
  if (url.hostname.includes('google-analytics')) return;
  if (url.hostname.includes('googletagmanager')) return;
  // ✅ FIX: Bypass Kie.ai / aiquickdraw temp files (audio, images)
  if (url.hostname.includes('aiquickdraw')) return;
  if (url.hostname.includes('kie.ai')) return;
  if (url.hostname.includes('tempfile')) return;
  // Skip non-http
  if (!url.protocol.startsWith('http')) return;

  // ===== HTML navigation - ALWAYS network first =====
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then((cached) => cached || caches.match('/') || new Response('Offline', { status: 503 }));
        })
    );
    return;
  }

  // ===== Fonts - cache first (they never change) =====
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // ===== Images in /images/ or /icons/ - network first, cache-bust with version =====
  // This ensures updated photos with the same filename always show the new version
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i)) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // ✅ FIX: Always return a valid Response, never undefined
          return caches.match(request)
            .then((cached) => cached || new Response('', { status: 404, statusText: 'Not Found' }));
        })
    );
    return;
  }

  // ===== Everything else (JS/CSS bundles) - network first with cache fallback =====
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // ✅ FIX: Always return a valid Response, never undefined
        return caches.match(request)
          .then((cached) => cached || new Response('', { status: 503, statusText: 'Offline' }));
      })
  );
});

console.log('[SW] RegalosQueCantan service worker loaded');
