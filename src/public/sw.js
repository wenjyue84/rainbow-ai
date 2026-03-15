/**
 * Service Worker — PWA Push Notifications (US-916)
 *
 * Handles push events and notification click interactions
 * for the Makan Moments Cafe webchat widget.
 */

/* eslint-env serviceworker */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Makan Moments', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/public/icons/icon-192.png',
    badge: payload.badge || '/public/icons/badge-72.png',
    tag: payload.tag || 'default',
    data: payload.data || {},
    actions: payload.actions || [],
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Makan Moments', options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const data = event.notification.data || {};

  // Determine URL to open
  let url = '/public/webchat.html';
  if (data.orderId) {
    url += '?orderId=' + encodeURIComponent(data.orderId);
  }
  if (action === 'view_order' && data.orderId) {
    url += '?orderId=' + encodeURIComponent(data.orderId);
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing webchat tab if open
      for (const client of clients) {
        if (client.url.includes('webchat') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});
