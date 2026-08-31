/*
 * Service worker — the only reason a notification can arrive when Pillar is
 * closed. Without one registered, the browser has nothing to wake.
 *
 * Kept deliberately small: it shows what it is given and opens the right page
 * when tapped. No caching, no offline strategy — Pillar needs the network to be
 * of any use, and a stale cached shell would be worse than an honest failure.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* keep the default */ }

  const title = data.title || 'Pillar';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    /* Same tag replaces rather than stacks, so ten dinner replies are one
       notification and not ten. */
    tag: data.tag || 'pillar',
    renotify: Boolean(data.renotify),
    data: { url: data.url || '/' },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* Focus a window that is already open rather than piling up new ones. */
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
