const CACHE_SCHEMA = 'v34';
const CACHE_NAMESPACE = `minimalist-offline-${CACHE_SCHEMA}`;
const SERVICE_WORKER_BUILD = (
  new URL(self.location.href).searchParams.get('build') || 'unversioned'
)
  .replace(/[^A-Za-z0-9._-]+/g, '-')
  .slice(0, 80);
const CACHE_NAME = `${CACHE_NAMESPACE}-${SERVICE_WORKER_BUILD}`;
const STATIC_CACHE = `${CACHE_NAME}-static`;
const STATIC_CACHE_MAX_ENTRIES = 180;
const OFFLINE_BOOTSTRAP_MANIFEST = '/offline-bootstrap.json';
const OFFLINE_BOOTSTRAP_REQUEST = `${OFFLINE_BOOTSTRAP_MANIFEST}?build=${encodeURIComponent(SERVICE_WORKER_BUILD)}`;
const ACTIVE_BUILD_MARKER = '/__minimalist-active-service-worker__';
const NAVIGATION_DOCUMENT_PATH = '/';
const NAVIGATION_CACHE_KEY = '/index.html';
const BUILD_VERSIONED_BOOTSTRAP_PATHS = new Set(['/config.js', '/load-css.js']);
const CURRENT_BUILD_CLIENTS = new Set();
const APP_SHELL = [
  NAVIGATION_CACHE_KEY,
  '/manifest.json',
  buildVersionedBootstrapUrl('/config.js?v=localai7'),
  buildVersionedBootstrapUrl('/load-css.js?v=8'),
  '/base.css?v=split40',
  '/icon.svg',
  '/phosphor-bold-subset.css?v=4',
];

self.addEventListener('install', (event) => {
  // Stage the complete bootstrap closure before taking control. Previous caches
  // remain available after activation for pages still running an older build.
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

function buildVersionedBootstrapUrl(value) {
  const url = new URL(String(value || ''), self.location.origin);
  if (BUILD_VERSIONED_BOOTSTRAP_PATHS.has(url.pathname)) {
    url.searchParams.set('build', SERVICE_WORKER_BUILD);
  }
  return `${url.pathname}${url.search}`;
}

async function deletePreviousGenerationCaches() {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith('minimalist-offline-')
      && key !== CACHE_NAME
      && key !== STATIC_CACHE)
    .map((key) => caches.delete(key)));
}

async function prunePreviousCachesWhenClientsMatchBuild(source, data) {
  const sourceId = source?.id;
  if (!sourceId || data?.build !== SERVICE_WORKER_BUILD) return false;

  let entrypoint = '';
  try {
    entrypoint = normalizedAssetUrl(data.entrypoint);
  } catch {
    return false;
  }

  const cache = await caches.open(CACHE_NAME);
  const activeMarker = await cache.match(ACTIVE_BUILD_MARKER);
  if (!activeMarker?.ok) return false;
  const manifest = await cachedOfflineBootstrap(cache);
  const expectedEntrypoint = manifest?.payload?.entrypoints?.main;
  if (!expectedEntrypoint || entrypoint !== normalizedAssetUrl(expectedEntrypoint)) return false;

  CURRENT_BUILD_CLIENTS.add(sourceId);
  const windowClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const liveClientIds = new Set(windowClients.map((client) => client.id));
  for (const clientId of CURRENT_BUILD_CLIENTS) {
    if (!liveClientIds.has(clientId)) CURRENT_BUILD_CLIENTS.delete(clientId);
  }

  if (!windowClients.length
    || windowClients.some((client) => !CURRENT_BUILD_CLIENTS.has(client.id))) {
    return false;
  }

  await deletePreviousGenerationCaches();
  return true;
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'minimalist:service-worker-build-ready') return;
  event.waitUntil(
    prunePreviousCachesWhenClientsMatchBuild(event.source, event.data).catch(() => false),
  );
});

function bootstrapAssetUrls(html) {
  const urls = new Set();
  const attributePattern = /\b(?:href|src)=["']([^"'<>]+)["']/gi;
  let match = attributePattern.exec(html);

  while (match) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
        urls.add(`${url.pathname}${url.search}`);
      }
    } catch {
      // Ignore malformed or non-URL attributes in the document shell.
    }
    match = attributePattern.exec(html);
  }

  return Array.from(urls);
}

async function cacheResponse(cache, request, response) {
  if (!response?.ok) return false;
  await cache.put(request, response);
  return true;
}

function normalizedAssetUrl(value) {
  const url = new URL(String(value || ''), self.location.origin);
  return `${url.pathname}${url.search}`;
}

function validOfflineBootstrapAsset(value) {
  try {
    const url = new URL(String(value || ''), self.location.origin);
    return url.origin === self.location.origin
      && (
        url.pathname.startsWith('/assets/')
        || /^\/(?:base|desktop|mobile|mobile-app-dock|load-css|config|manifest|icon|phosphor-bold-subset)\.[^/]+$/i.test(url.pathname)
        || url.pathname.startsWith('/themes/')
      );
  } catch {
    return false;
  }
}

function parseOfflineBootstrapManifest(payload) {
  if (payload?.schemaVersion !== 2 || payload?.route !== 'chat' || !Array.isArray(payload.assets)) {
    throw new Error('Invalid offline Chat bootstrap manifest.');
  }
  const assets = [...new Set(payload.assets.filter(validOfflineBootstrapAsset).map(normalizedAssetUrl))];
  if (!assets.length || assets.length > 160 || assets.length !== payload.assets.length) {
    throw new Error('Offline Chat bootstrap manifest has an invalid asset set.');
  }
  return assets;
}

async function fetchOfflineBootstrapManifest({ required = false } = {}) {
  try {
    const response = await fetch(OFFLINE_BOOTSTRAP_REQUEST, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.clone().json();
    return {
      assets: parseOfflineBootstrapManifest(payload),
      payload,
      response,
    };
  } catch (error) {
    if (required) throw new Error(`Offline bootstrap manifest could not be cached: ${error.message}`);
    return null;
  }
}

function isImmutableHashedAsset(value) {
  try {
    const url = new URL(String(value || ''), self.location.origin);
    return url.origin === self.location.origin
      && /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:css|js|mjs|svg|png|jpe?g|webp|gif|ico|woff2?|ttf)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function cacheRequiredAsset(cache, url) {
  if (isImmutableHashedAsset(url)) {
    const cached = await caches.match(url).catch(() => null);
    if (cached?.ok) {
      if (!await cache.match(url)) await cache.put(url, cached.clone());
      return;
    }
  }

  const response = await fetch(url, { cache: 'no-store' });
  if (!await cacheResponse(cache, url, response)) {
    throw new Error(`Offline bootstrap asset could not be cached: ${url}`);
  }
}

async function cacheBootstrapAssets(cache, html, manifestAssets) {
  const requiredAssets = [...new Set([
    ...APP_SHELL.filter((url) => url !== NAVIGATION_CACHE_KEY),
    ...manifestAssets.map(buildVersionedBootstrapUrl),
    ...bootstrapAssetUrls(html).map(buildVersionedBootstrapUrl),
  ])];
  await Promise.all(requiredAssets.map((url) => cacheRequiredAsset(cache, url)));
  return requiredAssets;
}

async function commitNavigationShell(indexResponse, preparedManifest = null) {
  if (!isSafeNavigationDocument(indexResponse)) {
    throw new Error('Offline shell could not be downloaded without a redirect.');
  }
  const manifest = preparedManifest || await fetchOfflineBootstrapManifest({ required: true });
  const cache = await caches.open(CACHE_NAME);
  const html = await indexResponse.clone().text();
  await cacheBootstrapAssets(cache, html, manifest.assets);

  // Publish the new document only after its complete bootstrap closure exists.
  await cache.put(NAVIGATION_CACHE_KEY, indexResponse);
  await cache.put(OFFLINE_BOOTSTRAP_MANIFEST, manifest.response);
}

async function cacheAppShell() {
  const indexResponse = await fetch(NAVIGATION_DOCUMENT_PATH, {
    cache: 'no-store',
    redirect: 'error',
  });
  await commitNavigationShell(indexResponse);
}

self.addEventListener('activate', (event) => {
  const enableNavigationPreload = Promise.resolve(
    self.registration.navigationPreload?.enable?.(),
  ).catch(() => undefined);
  event.waitUntil(
    enableNavigationPreload
      .then(async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(ACTIVE_BUILD_MARKER, new Response(SERVICE_WORKER_BUILD));
        await self.clients.claim();
      }),
  );
});

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
  const cached = caches.match(request).catch(() => null);
  const network = fetch(request, { cache: 'no-store' });
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

async function cachedNavigationShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(NAVIGATION_CACHE_KEY).catch(() => null);
  if (isSafeNavigationDocument(response)) return response;
  if (response) await cache.delete(NAVIGATION_CACHE_KEY).catch(() => undefined);
  return null;
}

async function navigationBootstrapKey(response) {
  if (!response?.ok) return '';
  try {
    const html = await response.clone().text();
    return bootstrapAssetUrls(html).sort().join('|');
  } catch {
    return '';
  }
}

function offlineBootstrapKey(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return JSON.stringify({
    assets: payload.assets || [],
    entrypoints: payload.entrypoints || {},
  });
}

async function cachedOfflineBootstrap(cache) {
  const response = await cache.match(OFFLINE_BOOTSTRAP_MANIFEST);
  if (!response?.ok) return null;
  try {
    const payload = await response.clone().json();
    parseOfflineBootstrapManifest(payload);
    return { payload, response };
  } catch {
    return null;
  }
}

async function cacheCurrentNavigationDocument(response, manifest) {
  if (!isSafeNavigationDocument(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await Promise.all([
    cache.put(NAVIGATION_CACHE_KEY, response),
    manifest?.response?.ok
      ? cache.put(OFFLINE_BOOTSTRAP_MANIFEST, manifest.response)
      : Promise.resolve(),
  ]);
}

function isSafeNavigationDocument(response) {
  return Boolean(
    response?.ok
    && !response.redirected
    && response.type !== 'opaqueredirect',
  );
}

function offlineNavigationResponse() {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minimalist is offline</title><body><main><h1>Minimalist could not reconnect</h1><p>Check your connection, then try again.</p><a href="/">Try again</a></main></body></html>',
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  );
}

async function prepareNavigation(event) {
  const cached = await cachedNavigationShell();
  try {
    const preloaded = await Promise.resolve(event.preloadResponse).catch(() => null);
    const network = isSafeNavigationDocument(preloaded)
      ? preloaded
      : await fetch(NAVIGATION_DOCUMENT_PATH, {
        cache: 'no-store',
        redirect: 'error',
      });
    if (!isSafeNavigationDocument(network)) {
      return {
        response: cached || offlineNavigationResponse(),
        cacheUpdate: Promise.resolve(),
      };
    }

    const cache = await caches.open(CACHE_NAME);
    const [cachedBootstrap, networkBootstrap, cachedManifest, networkManifest] = await Promise.all([
      navigationBootstrapKey(cached),
      navigationBootstrapKey(network),
      cachedOfflineBootstrap(cache),
      fetchOfflineBootstrapManifest().catch(() => null),
    ]);
    const sameGeneration = cached?.ok
      && cachedBootstrap
      && cachedBootstrap === networkBootstrap
      && offlineBootstrapKey(cachedManifest?.payload)
      && offlineBootstrapKey(cachedManifest?.payload) === offlineBootstrapKey(networkManifest?.payload);
    if (sameGeneration) {
      return {
        response: network,
        cacheUpdate: cacheCurrentNavigationDocument(network.clone(), networkManifest),
      };
    }

    if (!networkManifest) {
      return {
        response: cached || network,
        cacheUpdate: Promise.resolve(),
      };
    }

    try {
      await commitNavigationShell(network.clone(), networkManifest);
      return { response: network, cacheUpdate: Promise.resolve() };
    } catch {
      return {
        response: cached || network,
        cacheUpdate: Promise.resolve(),
      };
    }
  } catch {
    return {
      response: cached || offlineNavigationResponse(),
      cacheUpdate: Promise.resolve(),
    };
  }
}

function cacheFirst(request, event) {
  const work = caches.match(request).catch(() => null).then(async (cached) => {
    if (cached) return { response: cached, cacheWrite: Promise.resolve() };
    const cache = await caches.open(STATIC_CACHE).catch(() => null);
    const response = await fetch(request, { cache: 'no-store' });
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
    || url.pathname === '/load-css.js') {
    const versionedUrl = new URL(buildVersionedBootstrapUrl(request.url), self.location.origin);
    event.respondWith(staleWhileRevalidate(new Request(versionedUrl, request), event));
    return;
  }
  if (url.pathname === '/manifest.json') {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }
  if (url.pathname === '/sw.js' || url.pathname === '/service-worker.js') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    const navigation = prepareNavigation(event);
    event.respondWith(navigation.then(({ response }) => response));
    event.waitUntil(
      navigation
        .then(({ cacheUpdate }) => cacheUpdate)
        .catch(() => undefined),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/marketing/')) {
    event.respondWith(staleWhileRevalidate(request, event));
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
