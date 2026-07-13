// Service worker for Regalos Que Cantan.
//
// SCOPE: push notifications ONLY. There is intentionally NO fetch handler and
// NO caching here — a previous cached-HTML incident served stale pages in
// production, so every request must keep going straight to the network.
// (The activate handler also clears any cache an older SW may have left.)

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Regalos Que Cantan';
  const tag = data.tag || 'rqc';
  // Sales get the celebratory treatment: a distinctive "ka-ching" vibration,
  // a quick-action button, and they stay on screen until tapped. notify-new-sales
  // tags these 'sale-<id>'. (Android plays the notification channel's default
  // sound; web push can't attach a custom audio file, so there's no sound field.)
  const isSale = /^sale-/.test(tag) || /venta|paid|sale/i.test(title);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      // Badge must be a white-on-transparent silhouette — Android renders only
      // its alpha channel; a colored image becomes a solid white box.
      badge: '/icons/badge-96.png',
      tag,
      renotify: true,
      vibrate: isSale ? [150, 75, 150, 75, 400] : [200, 100, 200],
      requireInteraction: isSale,
      actions: [{ action: 'view', title: isSale ? '💸 Ver pedido' : 'Abrir' }],
      data: { url: data.url || '/admin/dashboard?tab=sms' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin/dashboard?tab=sms';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.includes('/admin')) {
          await client.focus();
          if (client.navigate) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
