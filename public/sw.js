const CACHE_NAME = 'minimalist-offline-v27';
const STATIC_CACHE = `${CACHE_NAME}-static`;
const STATIC_CACHE_MAX_ENTRIES = 180;
const APP_SHELL = [
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const enableNavigationPreload = self.registration.navigationPreload
    ? self.registration.navigationPreload.enable().catch(() => undefined)
    : Promise.resolve();
  event.waitUntil(
    Promise.all([
      caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE).map((key) => caches.delete(key)))),
      enableNavigationPreload,
    ]).then(() => self.clients.claim()),
  );
});

function networkOnly(request) {
  return fetch(request, { cache: 'no-store' });
}

async function trimCache(cache, maxEntries = STATIC_CACHE_MAX_ENTRIES) {
  const keys = await cache.keys();
  const overflow = keys.length - maxEntries;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}

async function storeStaticResponse(cache, request, response) {
  await cache.put(request, response);
  await trimCache(cache);
}

function staleWhileRevalidate(request, event) {
  const cache = caches.open(STATIC_CACHE).catch(() => null);
  const cached = cache
    .then((openedCache) => openedCache?.match(request) || null)
    .catch(() => null);
  const network = fetch(request);
  const cacheUpdate = Promise.all([cache, network])
    .then(([openedCache, response]) => (
      openedCache && response.ok
        ? storeStaticResponse(openedCache, request, response.clone())
        : undefined
    ))
    .catch(() => undefined);

  event.waitUntil(cacheUpdate);
  return cached.then((response) => response || network);
}

function cacheFirst(request, event) {
  const work = caches.open(STATIC_CACHE).catch(() => null).then(async (cache) => {
    const cached = cache ? await cache.match(request).catch(() => null) : null;
    if (cached) return { response: cached, cacheWrite: Promise.resolve() };
    const response = await fetch(request);
    const cacheWrite = cache && response.ok
      ? storeStaticResponse(cache, request, response.clone())
      : Promise.resolve();
    return { response, cacheWrite };
  });
  event.waitUntil(work.then(({ cacheWrite }) => cacheWrite).catch(() => undefined));
  return work.then(({ response }) => response);
}

function fetchWithTimeout(request, timeoutMs = 0) {
  if (!timeoutMs || typeof AbortController === 'undefined') return fetch(request, { cache: 'no-store' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { cache: 'no-store', signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function networkFirst(request, fallbackPath = null, options = {}) {
  const networkResponse = Promise.resolve(options.preloadResponse)
    .catch(() => null)
    .then((preloaded) => preloaded || fetchWithTimeout(request, options.timeoutMs));

  if (fallbackPath && options.event) {
    options.event.waitUntil(networkResponse
      .then((response) => (
        response.ok
          ? caches.open(CACHE_NAME).then((cache) => cache.put(fallbackPath, response.clone()))
          : undefined
      ))
      .catch(() => undefined));
  }

  return networkResponse
    .then((response) => response)
    .catch(() => (fallbackPath ? caches.match(fallbackPath) : caches.match(request)));
}

function isCacheableStaticAsset(url) {
  if (url.pathname.startsWith('/assets/')) return true;
  return /\.(?:css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|json)$/i.test(url.pathname);
}

function notificationOpenPath(data = {}) {
  const targetUid = data.targetUid || data.pmTargetUid;
  if ((data.type === 'minimalist-open-pm' || data.action === 'pm') && targetUid) {
    const params = new URLSearchParams({
      notification: 'pm',
      pmTargetUid: String(targetUid),
    });
    const targetName = data.targetName || data.pmTargetName || data.fromName;
    if (targetName) params.set('pmTargetName', String(targetName));
    return `/chat?${params.toString()}`;
  }

  return '/chat';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__/auth')) return;
  if (url.pathname === '/config.js'
    || url.pathname === '/load-css.js'
    || url.pathname === '/manifest.json'
    || url.pathname === '/sw.js'
    || url.pathname === '/service-worker.js') {
    event.respondWith(networkOnly(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html', {
      event,
      preloadResponse: event.preloadResponse,
      timeoutMs: 3000,
    }));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, event));
    return;
  }

  if (isCacheableStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  event.respondWith(networkFirst(request));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const chatClient = windows.find((client) => new URL(client.url).pathname.startsWith('/chat'));

    if (chatClient) {
      await chatClient.focus();
      chatClient.postMessage(data);
      return;
    }

    const opened = await self.clients.openWindow(notificationOpenPath(data));
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
