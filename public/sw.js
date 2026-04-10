// SELF-DESTRUCTING SERVICE WORKER
// This SW's only job is to uninstall itself and clear all caches.
// Browsers re-fetch /sw.js on every navigation, so any client that
// previously had a stale SW will pick this up and auto-uninstall.
//
// Once we're confident every visitor has been hit (a few weeks),
// this file can be deleted entirely.

self.addEventListener('install', (event) => {
  // Skip waiting so we can activate immediately on next load
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Delete every cache this origin has
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {}

      // 2. Unregister ourselves
      try {
        await self.registration.unregister();
      } catch (e) {}

      // 3. Force-reload every open tab so they drop the SW controller
      try {
        const clientsList = await self.clients.matchAll({ type: 'window' });
        clientsList.forEach((client) => {
          if ('navigate' in client) {
            client.navigate(client.url);
          }
        });
      } catch (e) {}
    })()
  );
});

// Fetch handler: pass everything straight to network, touch nothing
self.addEventListener('fetch', (event) => {
  // No-op — let the browser handle it normally
});
