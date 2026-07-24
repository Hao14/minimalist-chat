import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ORIGIN = 'https://minimalist.test';
const NAVIGATION_DOCUMENT_PATH = '/';
const NAVIGATION_CACHE_KEY = '/index.html';
const SW_SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const MAIN_SOURCE = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const SW_RUNTIME_SOURCE = readFileSync(new URL('../src/serviceWorkerRuntime.js', import.meta.url), 'utf8');
const SOURCE_INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const INDEX_HTML = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const FIREBASE_CONFIG = JSON.parse(
  readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'),
);
const BOOTSTRAP_MANIFEST = JSON.parse(
  readFileSync(new URL('../dist/offline-bootstrap.json', import.meta.url), 'utf8'),
);
const APP_SHELL_ASSETS = [
  '/manifest.json',
  '/config.js?v=localai7',
  '/load-css.js?v=8',
  '/base.css?v=split40',
  '/icon.svg',
  '/phosphor-bold-subset.css?v=4',
];
const BUILD_VERSIONED_BOOTSTRAP_PATHS = new Set(['/config.js', '/load-css.js']);

function workerAssetUrl(value, build = 'test') {
  const url = new URL(value, ORIGIN);
  if (BUILD_VERSIONED_BOOTSTRAP_PATHS.has(url.pathname)) {
    url.searchParams.set('build', build);
  }
  return `${url.pathname}${url.search}`;
}

function documentScriptUrl(html, pathname) {
  const escapedPath = pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(
    `<script\\b[^>]*\\bsrc=["']([^"']*${escapedPath}[^"']*)["']`,
    'i',
  ));
  return match?.[1]
    ? new URL(match[1].replaceAll('&amp;', '&'), ORIGIN)
    : null;
}

function requestUrl(input) {
  const value = typeof input === 'string' ? input : input?.url;
  return new URL(value, ORIGIN).href;
}

class MemoryCache {
  constructor() {
    this.entries = new Map();
  }

  async delete(input) {
    return this.entries.delete(requestUrl(input));
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async match(input) {
    return this.entries.get(requestUrl(input))?.clone();
  }

  async put(input, response) {
    this.entries.set(requestUrl(input), response.clone());
  }
}

class MemoryCacheStorage {
  constructor() {
    this.caches = new Map();
  }

  async delete(name) {
    return this.caches.delete(name);
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async match(input) {
    for (const cache of this.caches.values()) {
      const response = await cache.match(input);
      if (response) return response;
    }
    return undefined;
  }

  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new MemoryCache());
    return this.caches.get(name);
  }
}

function responseFor(value, path) {
  if (value instanceof Response) return value.clone();
  const isJson = new URL(path, ORIGIN).pathname.endsWith('.json');
  return new Response(
    isJson && typeof value !== 'string' ? JSON.stringify(value) : String(value),
    {
      headers: {
        'content-type': isJson ? 'application/json' : 'text/plain',
      },
      status: 200,
    },
  );
}

function createHarness({ windowClientIds = ['current-client'] } = {}) {
  const listeners = new Map();
  const cacheStorage = new MemoryCacheStorage();
  const routes = new Map();
  const requests = new Map();
  let online = true;
  let skippedWaiting = false;
  let liveWindowClientIds = [...windowClientIds];

  const setRoute = (path, value) => {
    const url = new URL(path, ORIGIN);
    routes.set(`${url.pathname}${url.search}`, value);
    if (url.pathname === '/offline-bootstrap.json' && !url.search) {
      routes.set('/offline-bootstrap.json?build=test', value);
    }
  };
  setRoute(NAVIGATION_DOCUMENT_PATH, INDEX_HTML);
  setRoute('/offline-bootstrap.json', BOOTSTRAP_MANIFEST);
  [...BOOTSTRAP_MANIFEST.assets, ...APP_SHELL_ASSETS].forEach((path) => {
    if (!routes.has(path)) setRoute(path, `network:${path}`);
    const versionedPath = workerAssetUrl(path);
    if (!routes.has(versionedPath)) setRoute(versionedPath, `network:${versionedPath}`);
  });

  const fakeFetch = async (input) => {
    const url = new URL(requestUrl(input));
    const path = `${url.pathname}${url.search}`;
    requests.set(path, (requests.get(path) || 0) + 1);
    if (!online) throw new TypeError('Network unavailable');
    if (!routes.has(path)) return new Response('Not found', { status: 404 });
    const route = routes.get(path);
    return typeof route === 'function'
      ? route({ input, path, url })
      : responseFor(route, path);
  };

  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => liveWindowClientIds.map((id) => ({ id })),
      openWindow: async () => null,
    },
    location: new URL(`${ORIGIN}/sw.js?build=test`),
    registration: {
      showNotification: async () => undefined,
    },
    async skipWaiting() {
      skippedWaiting = true;
    },
  };

  vm.runInNewContext(SW_SOURCE, {
    AbortController,
    Map,
    Promise,
    Request,
    Response,
    Set,
    URL,
    URLSearchParams,
    caches: cacheStorage,
    clearTimeout,
    console,
    fetch: fakeFetch,
    self,
    setTimeout,
  }, { filename: 'public/sw.js' });

  async function dispatchInstall() {
    const waits = [];
    listeners.get('install')({
      waitUntil(promise) {
        waits.push(Promise.resolve(promise));
      },
    });
    await Promise.all(waits);
  }

  async function dispatchActivate() {
    const waits = [];
    listeners.get('activate')({
      waitUntil(promise) {
        waits.push(Promise.resolve(promise));
      },
    });
    await Promise.all(waits);
  }

  async function dispatchFetch(path, mode = 'same-origin') {
    const waits = [];
    let responsePromise;
    listeners.get('fetch')({
      request: {
        method: 'GET',
        mode,
        redirect: mode === 'navigate' ? 'manual' : 'follow',
        url: new URL(path, ORIGIN).href,
      },
      respondWith(promise) {
        responsePromise = Promise.resolve(promise);
      },
      waitUntil(promise) {
        waits.push(Promise.resolve(promise));
      },
    });
    assert.ok(responsePromise, `Service worker did not handle ${path}.`);
    const response = await responsePromise;
    await Promise.all(waits);
    return response;
  }

  async function dispatchMessage(sourceId, data) {
    const waits = [];
    listeners.get('message')({
      data,
      source: sourceId ? { id: sourceId } : null,
      waitUntil(promise) {
        waits.push(Promise.resolve(promise));
      },
    });
    await Promise.all(waits);
  }

  return {
    caches: cacheStorage,
    dispatchActivate,
    dispatchFetch,
    dispatchInstall,
    dispatchMessage,
    get skippedWaiting() {
      return skippedWaiting;
    },
    networkRequests(path) {
      return requests.get(path) || 0;
    },
    setOnline(value) {
      online = value;
    },
    setWindowClients(clientIds) {
      liveWindowClientIds = [...clientIds];
    },
    setRoute,
  };
}

test('install caches the generated Chat closure and serves it completely offline', async () => {
  assert.equal(BOOTSTRAP_MANIFEST.schemaVersion, 2);
  assert.equal(BOOTSTRAP_MANIFEST.route, 'chat');
  assert.ok(Object.keys(BOOTSTRAP_MANIFEST.entrypoints).length >= 8);
  assert.match(
    BOOTSTRAP_MANIFEST.entrypoints['quick-replies'],
    /^\/assets\/QuickReplies-[A-Za-z0-9_-]{8,}\.js$/,
  );
  Object.values(BOOTSTRAP_MANIFEST.entrypoints).forEach((entrypoint) => {
    assert.match(entrypoint, /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|mjs)$/);
    assert.ok(BOOTSTRAP_MANIFEST.assets.includes(entrypoint));
  });

  const harness = createHarness();
  await harness.dispatchInstall();
  assert.equal(
    harness.skippedWaiting,
    true,
    'The worker should activate only after its complete bootstrap closure is cached.',
  );
  assert.ok(
    harness.networkRequests(NAVIGATION_DOCUMENT_PATH) > 0,
    'The worker must fetch the canonical clean URL for its navigation shell.',
  );
  assert.equal(
    harness.networkRequests(NAVIGATION_CACHE_KEY),
    0,
    'The worker must not fetch /index.html because Firebase redirects that clean URL.',
  );

  for (const asset of BOOTSTRAP_MANIFEST.assets) {
    const cacheKey = workerAssetUrl(asset);
    assert.ok(await harness.caches.match(cacheKey), `Install did not cache ${cacheKey}.`);
  }

  const mainAsset = BOOTSTRAP_MANIFEST.entrypoints.main;
  const mainNetworkRequests = harness.networkRequests(mainAsset);
  harness.setOnline(false);

  const navigation = await harness.dispatchFetch('/chat', 'navigate');
  assert.equal(await navigation.text(), INDEX_HTML);

  for (const asset of BOOTSTRAP_MANIFEST.assets) {
    const response = await harness.dispatchFetch(asset);
    assert.equal(response.ok, true, `Offline fetch failed for ${asset}.`);
  }
  assert.equal(
    harness.networkRequests(mainAsset),
    mainNetworkRequests,
    'cacheFirst re-downloaded an immutable asset already stored in the app cache.',
  );
});

test('production registration versions the service worker with the build number', () => {
  assert.match(MAIN_SOURCE, /import\.meta\.env\.VITE_APP_BUILD_NUMBER/);
  assert.match(MAIN_SOURCE, /import\('\.\/serviceWorkerRuntime\.js'\)/);
  assert.match(
    SW_RUNTIME_SOURCE,
    /navigator\.serviceWorker\.register\(\s*`\/sw\.js\?build=\$\{encodeURIComponent\(build\)\}`,\s*\{ updateViaCache: 'none' \}/,
  );
  assert.match(
    MAIN_SOURCE,
    /document\.readyState === ['"]complete['"]/,
    'late-loading app entry should register even when the window load event already fired',
  );
  assert.match(SW_SOURCE, /new URL\(self\.location\.href\)\.searchParams\.get\('build'\)/);
  assert.match(SW_SOURCE, /OFFLINE_BOOTSTRAP_REQUEST/);
  assert.match(
    SW_SOURCE,
    /cacheAppShell\(\)\.then\(\(\) => self\.skipWaiting\(\)\)/,
    'The staged worker must be able to replace an older worker without waiting for legacy code to attest.',
  );
  assert.match(SW_SOURCE, /prunePreviousCachesWhenClientsMatchBuild/);
  assert.match(SW_SOURCE, /const response = await cache\.match\(NAVIGATION_CACHE_KEY\)/);
  assert.match(SW_SOURCE, /await cache\.delete\(NAVIGATION_CACHE_KEY\)/);
  assert.match(SW_RUNTIME_SOURCE, /registration\?\.active/);
  assert.match(SW_RUNTIME_SOURCE, /registration\?\.waiting/);
  assert.match(SW_RUNTIME_SOURCE, /entrypoint: mainEntrypoint/);
  assert.match(
    BOOTSTRAP_MANIFEST.entrypoints['service-worker-runtime'],
    /^\/assets\/serviceWorkerRuntime-[A-Za-z0-9_-]{8,}\.js$/,
  );
});

test('redirected navigation documents are rejected instead of reaching respondWith', async () => {
  const harness = createHarness();
  await harness.dispatchInstall();
  const cachedIndex = await (await harness.caches.match(NAVIGATION_CACHE_KEY)).text();

  harness.setRoute(NAVIGATION_DOCUMENT_PATH, () => {
    const response = new Response('redirected document');
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  });

  const navigation = await harness.dispatchFetch('/chat', 'navigate');
  assert.equal(navigation.redirected, false);
  assert.equal(await navigation.text(), cachedIndex);
  assert.equal(
    await (await harness.caches.match(NAVIGATION_CACHE_KEY)).text(),
    cachedIndex,
    'A redirected document must not replace the safe cached shell.',
  );
});

test('production HTML versions mutable bootstrap scripts without changing source development tags', () => {
  assert.match(SOURCE_INDEX_HTML, /src="\/load-css\.js\?v=8"/);
  assert.match(SOURCE_INDEX_HTML, /src="\/config\.js\?v=localai7"/);

  const loadCssUrl = documentScriptUrl(INDEX_HTML, '/load-css.js');
  const configUrl = documentScriptUrl(INDEX_HTML, '/config.js');
  assert.ok(loadCssUrl, 'Built HTML is missing load-css.js.');
  assert.ok(configUrl, 'Built HTML is missing config.js.');
  assert.equal(loadCssUrl.searchParams.get('v'), '8');
  assert.equal(configUrl.searchParams.get('v'), 'localai7');
  assert.ok(loadCssUrl.searchParams.get('build'), 'Built load-css.js URL is missing its build key.');
  assert.equal(
    configUrl.searchParams.get('build'),
    loadCssUrl.searchParams.get('build'),
    'Mutable bootstrap scripts must use one release key.',
  );
});

test('staged v34 activates without legacy cooperation and prunes old caches only after safe handoff', async () => {
  const harness = createHarness({
    windowClientIds: ['updated-tab', 'legacy-v32-tab'],
  });
  const legacyCacheName = 'minimalist-offline-v32';
  const legacyStaticCacheName = `${legacyCacheName}-static`;
  const legacyChunk = '/assets/legacy-room-tool-OLDHASH12.js';
  const legacyHtml = '<!doctype html><title>Legacy v32</title>';
  const legacyCache = await harness.caches.open(legacyCacheName);
  const legacyStaticCache = await harness.caches.open(legacyStaticCacheName);
  await legacyCache.put('/index.html', new Response(legacyHtml));
  await legacyStaticCache.put(legacyChunk, new Response('legacy chunk'));

  await harness.dispatchInstall();
  assert.equal(
    harness.skippedWaiting,
    true,
    'A legacy client that does not understand the protocol must not block v34 activation.',
  );
  await harness.dispatchActivate();
  assert.ok((await harness.caches.keys()).includes(legacyCacheName));
  assert.ok((await harness.caches.keys()).includes(legacyStaticCacheName));

  harness.setOnline(false);
  const navigation = await harness.dispatchFetch('/chat', 'navigate');
  assert.equal(
    await navigation.text(),
    INDEX_HTML,
    'Navigation must read the current generation cache, not an older cache inserted first.',
  );
  const oldChunkResponse = await harness.dispatchFetch(legacyChunk);
  assert.equal(
    await oldChunkResponse.text(),
    'legacy chunk',
    'A claimed v32 page must still be able to load its cached lazy chunks.',
  );
  harness.setOnline(true);

  const attestation = {
    type: 'minimalist:service-worker-build-ready',
    build: 'test',
    entrypoint: BOOTSTRAP_MANIFEST.entrypoints.main,
  };
  await harness.dispatchMessage('updated-tab', attestation);
  assert.ok(
    (await harness.caches.keys()).includes(legacyCacheName),
    'Legacy caches must remain while an unattested v32 client is open.',
  );

  await harness.dispatchMessage('legacy-v32-tab', {
    ...attestation,
    entrypoint: '/assets/main-STALE123.js',
  });
  assert.ok(
    (await harness.caches.keys()).includes(legacyCacheName),
    'A stale client entrypoint must not authorize pruning.',
  );

  harness.setWindowClients(['updated-tab']);
  await harness.dispatchMessage('updated-tab', attestation);
  assert.equal((await harness.caches.keys()).includes(legacyCacheName), false);
  assert.equal((await harness.caches.keys()).includes(legacyStaticCacheName), false);
});

test('mutable worker bootstrap files require revalidation at the hosting origin', () => {
  const expected = new Set([
    '/sw.js',
    '/service-worker.js',
    '/offline-bootstrap.json',
    '/build-info.json',
    '/config.js',
    '/load-css.js',
  ]);
  for (const entry of FIREBASE_CONFIG.hosting.headers) {
    if (!expected.has(entry.source)) continue;
    const cacheControl = entry.headers?.find((header) => (
      header.key.toLowerCase() === 'cache-control'
    ))?.value || '';
    assert.match(cacheControl, /no-cache/);
    assert.match(cacheControl, /no-store/);
    assert.match(cacheControl, /must-revalidate/);
    expected.delete(entry.source);
  }
  assert.deepEqual([...expected], []);
  assert.ok(
    FIREBASE_CONFIG.hosting.ignore?.some((pattern) => pattern.includes('.vite/')),
    'Vite build metadata must not be published by Hosting.',
  );
});

test('navigation changes generations atomically and retains the previous closure for open pages', async () => {
  const harness = createHarness();
  await harness.dispatchInstall();

  const previousMain = BOOTSTRAP_MANIFEST.entrypoints.main;
  const stableAsset = BOOTSTRAP_MANIFEST.entrypoints['chat-core'];
  const replacementMain = previousMain.replace(
    /-[A-Za-z0-9_-]{8,}\.(js|mjs)$/,
    '-NEWHASH2.$1',
  );
  assert.notEqual(replacementMain, previousMain);

  const nextManifest = {
    ...BOOTSTRAP_MANIFEST,
    entrypoints: {
      ...BOOTSTRAP_MANIFEST.entrypoints,
      main: replacementMain,
    },
    assets: BOOTSTRAP_MANIFEST.assets.map((asset) => (
      asset === previousMain ? replacementMain : asset
    )),
  };
  const nextIndex = INDEX_HTML.replace('</head>', '<meta name="offline-build" content="next"></head>');
  const originalIndex = await (await harness.caches.match('/index.html')).text();
  const stableNetworkRequests = harness.networkRequests(stableAsset);

  harness.setRoute(NAVIGATION_DOCUMENT_PATH, nextIndex);
  harness.setRoute('/offline-bootstrap.json', nextManifest);

  const incompleteNavigation = await harness.dispatchFetch('/chat', 'navigate');
  assert.equal(await incompleteNavigation.text(), originalIndex);
  assert.equal(await (await harness.caches.match('/index.html')).text(), originalIndex);
  assert.deepEqual(
    await (await harness.caches.match('/offline-bootstrap.json')).json(),
    BOOTSTRAP_MANIFEST,
  );
  assert.ok(await harness.caches.match(previousMain));

  harness.setRoute(replacementMain, `network:${replacementMain}`);
  const currentNavigation = await harness.dispatchFetch('/chat', 'navigate');

  assert.equal(await currentNavigation.text(), nextIndex);
  assert.equal(await (await harness.caches.match('/index.html')).text(), nextIndex);
  assert.deepEqual(
    await (await harness.caches.match('/offline-bootstrap.json')).json(),
    nextManifest,
  );
  assert.ok(await harness.caches.match(replacementMain));
  assert.ok(
    await harness.caches.match(previousMain),
    'A page from the previous generation can still request its lazy chunks.',
  );
  assert.equal(
    harness.networkRequests(stableAsset),
    stableNetworkRequests,
    'Navigation refresh re-downloaded an unchanged immutable hash.',
  );

  harness.setOnline(false);
  const previousGenerationChunk = await harness.dispatchFetch(previousMain);
  assert.equal(previousGenerationChunk.ok, true);
});
