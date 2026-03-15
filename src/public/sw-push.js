/**
 * sw-push.js — Service Worker for Web Push Notifications (US-916)
 *
 * Handles push events and notification click actions for the webchat widget.
 * Registered by the webchat widget after user grants notification permission.
 */

/* eslint-env serviceworker */
/* global self, clients */

self.addEventListener('push', function (event) {
  if (!event.data) return;

  var data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'New message', body: event.data.text() };
  }

  var title = data.title || 'Rainbow AI';
  var options = {
    body: data.body || '',
    icon: data.icon || '/public/icon-192.png',
    badge: data.badge || '/public/badge-72.png',
    tag: data.tag || 'rainbow-notification',
    renotify: true,
    data: {
      url: data.url || '/',
      profileId: data.profileId || '',
      sessionId: data.sessionId || '',
      type: data.type || 'general',
    },
    actions: data.actions || [
      { action: 'open', title: 'Open Chat' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Focus existing tab if open
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(url) !== -1 && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new tab
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
