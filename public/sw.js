const CACHE_NAME = 'minimalist-offline-v14';
const APP_SHELL = [
  '/',
  '/chat',
  '/index.html',
  '/base.css',
  '/desktop.css',
  '/mobile.css',
  '/features.css',
  '/manifest.json',
  '/config.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__/auth')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const chatClient = windows.find((client) => new URL(client.url).pathname.startsWith('/chat')) || windows[0];

    if (chatClient) {
      await chatClient.focus();
      chatClient.postMessage(data);
      return;
    }

    const opened = await self.clients.openWindow('/chat');
    if (opened) opened.postMessage(data);
  })());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Minimalist', body: event.data?.text() || 'New notification' };
  }

  const notification = payload.notification || {};
  const title = payload.title || notification.title || 'Minimalist';
  const options = {
    body: payload.body || notification.body || 'You have a new update.',
    tag: payload.tag || notification.tag || 'minimalist-update',
    data: payload.data || payload,
    renotify: Boolean(payload.renotify || notification.renotify),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
