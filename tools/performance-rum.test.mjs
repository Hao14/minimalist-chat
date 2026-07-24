import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createRealUserPerformanceMonitor,
  createRumPayload,
  normalizeRumRelease,
  resolveDeviceClass,
  resolveMemoryTier,
  sendRumPayload,
} from '../src/features/performance/realUserPerformance.js';
import { evaluateRumGate } from './rum-performance-gate.mjs';

const require = createRequire(import.meta.url);
const {
  METRIC_SPECS,
  buildAggregateUpdates,
  createPerformanceRumHandler,
  consumeDurableAdmission,
  metricBucketKey,
  normalizePerformanceBatch,
  requireActiveRumRelease,
  summarizeReleaseSnapshot,
} = require('../functions/performance-rum.js');

const projectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const execFileAsync = promisify(execFile);

function metricAggregate(name, boundIndex, count = 75) {
  const value = METRIC_SPECS[name].bounds[boundIndex];
  return {
    count,
    sum: value * count,
    bins: {
      [`b${String(boundIndex).padStart(2, '0')}`]: count,
    },
  };
}

function passingDevice() {
  return {
    batches: 75,
    memoryTiers: { low: 10, mid: 40, high: 20, unknown: 5 },
    metrics: {
      lcp: metricAggregate('lcp', 6),
      inp: metricAggregate('inp', 4),
      cls: metricAggregate('cls', 3),
    },
  };
}

function mockResponse() {
  return {
    headers: {},
    statusCode: 0,
    payload: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    },
  };
}

function mockRequest({
  method = 'POST',
  body = {},
  query = {},
  headers = {},
} = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    method,
    body,
    query,
    rawBody: Buffer.from(JSON.stringify(body)),
    get(name) {
      return normalizedHeaders[String(name).toLowerCase()] || '';
    },
  };
}

test('client dimensions stay coarse and payloads contain only allowlisted fields', () => {
  assert.equal(resolveDeviceClass({ viewportWidth: 390 }), 'mobile');
  assert.equal(resolveDeviceClass({ viewportWidth: 1440 }), 'desktop');
  assert.equal(resolveMemoryTier({ deviceMemory: 2 }), 'low');
  assert.equal(resolveMemoryTier({ deviceMemory: 4 }), 'mid');
  assert.equal(resolveMemoryTier({ deviceMemory: 8 }), 'high');
  assert.equal(resolveMemoryTier({}), 'unknown');
  assert.equal(normalizeRumRelease('1.2.3', 'abcdef12'), '1.2.3-abcdef12');

  assert.deepEqual(createRumPayload({
    release: '1.2.3-abcdef12',
    deviceClass: 'mobile',
    memoryTier: 'mid',
    metrics: { cls: 0.123456, lcp: 2499.6 },
  }), {
    schemaVersion: 1,
    release: '1.2.3-abcdef12',
    deviceClass: 'mobile',
    memoryTier: 'mid',
    metrics: { cls: 0.1235, lcp: 2500 },
  });
});

test('delivery requires configured App Check and never sends an unverifiable sample', async () => {
  const payload = createRumPayload({
    release: '1.0.0-deadbeef',
    deviceClass: 'desktop',
    memoryTier: 'mid',
    metrics: { lcp: 2000 },
  });
  let appCheckCalls = 0;
  let fetchOptions = null;
  const common = {
    endpoint: '/api/performance/vitals',
    locationObject: { protocol: 'https:', hostname: 'minimalist.chat' },
    navigatorObject: {
      sendBeacon: () => true,
    },
    windowObject: {
      Blob,
      FIREBASE_APP_CHECK_SITE_KEY: '',
    },
    fetchImpl: async (_url, options) => {
      fetchOptions = options;
      return { ok: true };
    },
    loadAppCheckHeaders: async () => {
      appCheckCalls += 1;
      return { 'X-Firebase-AppCheck': 'test-token' };
    },
  };
  assert.equal(await sendRumPayload(payload, common), false);
  assert.equal(appCheckCalls, 0);
  assert.equal(fetchOptions, null);

  assert.equal(await sendRumPayload(payload, {
    ...common,
    windowObject: {
      Blob,
      FIREBASE_APP_CHECK_SITE_KEY: 'configured',
    },
  }), true);
  assert.equal(appCheckCalls, 1);
  assert.equal(fetchOptions.headers['X-Firebase-AppCheck'], 'test-token');
  assert.equal(fetchOptions.keepalive, true);

  fetchOptions = null;
  assert.equal(await sendRumPayload(payload, {
    ...common,
    windowObject: {
      Blob,
      FIREBASE_APP_CHECK_SITE_KEY: 'configured',
    },
    loadAppCheckHeaders: async () => ({}),
  }), false);
  assert.equal(fetchOptions, null);
});

test('monitor preloads App Check and keeps observers active until the page is finalized', async () => {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const timeoutDelays = [];
  let appCheckCalls = 0;
  let fetchCalls = 0;
  let disconnected = false;
  const addListener = (map) => (name, listener) => {
    const listeners = map.get(name) || [];
    listeners.push(listener);
    map.set(name, listeners);
  };
  const windowObject = {
    location: { protocol: 'https:', hostname: 'minimalist.chat', pathname: '/chat' },
    FIREBASE_APP_CHECK_SITE_KEY: 'configured',
    MINIMALIST_FLAGS: { performanceRum: true },
    innerWidth: 390,
    addEventListener: addListener(windowListeners),
    requestIdleCallback: (callback) => {
      callback();
      return 1;
    },
    setTimeout: (_callback, delay) => {
      timeoutDelays.push(delay);
      return timeoutDelays.length;
    },
    clearTimeout: () => {},
    queueMicrotask,
    dispatchEvent: () => {},
    CustomEvent: class CustomEvent {
      constructor(name, init) {
        this.type = name;
        this.detail = init?.detail;
      }
    },
  };
  const documentObject = {
    readyState: 'complete',
    visibilityState: 'visible',
    addEventListener: addListener(documentListeners),
  };
  class PerformanceObserverMock {
    static supportedEntryTypes = ['longtask'];

    observe() {}

    disconnect() {
      disconnected = true;
    }
  }

  const monitor = createRealUserPerformanceMonitor({
    windowObject,
    documentObject,
    navigatorObject: {
      globalPrivacyControl: false,
      userAgentData: { mobile: true },
      deviceMemory: 4,
    },
    performanceObject: { now: () => 1234 },
    PerformanceObserverClass: PerformanceObserverMock,
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true };
    },
    loadWebVitals: async () => ({
      onCLS: () => {},
      onINP: () => {},
      onLCP: () => {},
    }),
    loadAppCheckHeaders: async () => {
      appCheckCalls += 1;
      return { 'X-Firebase-AppCheck': 'test-token' };
    },
    random: () => 0,
    release: '1.0.0-deadbeef',
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.ok(monitor);
  assert.equal(
    Object.hasOwn(monitor.snapshot().metrics, 'cls'),
    false,
    'CLS must stay absent until web-vitals produces a real observation.',
  );
  assert.equal(appCheckCalls, 1);
  assert.equal(disconnected, false);
  assert.doesNotMatch(timeoutDelays.join(','), /60000/);

  for (const listener of windowListeners.get('pagehide') || []) listener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disconnected, true);
  assert.equal(fetchCalls, 1);
  assert.equal(appCheckCalls, 2);

  assert.equal(createRealUserPerformanceMonitor({
    windowObject: { ...windowObject, FIREBASE_APP_CHECK_SITE_KEY: '' },
    documentObject,
    navigatorObject: {},
    performanceObject: {},
    random: () => 0,
  }), null);
});

test('server validation rejects identifying fields and out-of-range metrics', () => {
  const valid = {
    schemaVersion: 1,
    release: '1.0.0-deadbeef',
    deviceClass: 'desktop',
    memoryTier: 'high',
    metrics: { lcp: 2400, inp: 180, cls: 0.08 },
  };
  assert.deepEqual(normalizePerformanceBatch(valid), valid);
  assert.throws(
    () => normalizePerformanceBatch({ ...valid, url: '/chat/private-room' }),
    /unsupported field/i,
  );
  assert.throws(
    () => normalizePerformanceBatch({ ...valid, metrics: { lcp: 60001 } }),
    /invalid lcp metric/i,
  );
  assert.throws(
    () => normalizePerformanceBatch({ ...valid, memoryTier: '16gb' }),
    /memory tier/i,
  );
});

test('aggregate updates contain histograms and counters but no raw samples', () => {
  const batch = normalizePerformanceBatch({
    schemaVersion: 1,
    release: '1.0.0-deadbeef',
    deviceClass: 'mobile',
    memoryTier: 'mid',
    metrics: { lcp: 2500, cls: 0.1 },
  });
  const ServerValue = {
    TIMESTAMP: { server: 'timestamp' },
    increment: (value) => ({ increment: value }),
  };
  const aggregate = buildAggregateUpdates(batch, Date.UTC(2026, 6, 23), ServerValue);
  const serialized = JSON.stringify(aggregate.updates);
  assert.equal(aggregate.day, '2026-07-23');
  assert.match(serialized, /memoryTiers\/mid/);
  assert.match(serialized, /metrics\/lcp\/bins/);
  assert.equal(metricBucketKey('lcp', 2500), 'b06');
  assert.doesNotMatch(serialized, /url|user|account|room|ip|agent/i);
});

test('active releases and durable hourly admission prevent arbitrary or unbounded buckets', async () => {
  assert.doesNotThrow(() => requireActiveRumRelease('1.0.0-deadbeef', {
    PERFORMANCE_RUM_ACTIVE_RELEASES: '1.0.0-deadbeef,1.0.0-next',
  }));
  assert.throws(
    () => requireActiveRumRelease('attacker-release', {
      PERFORMANCE_RUM_ACTIVE_RELEASES: '1.0.0-deadbeef',
    }),
    /not active/i,
  );
  assert.throws(
    () => requireActiveRumRelease('1.0.0-deadbeef', {}),
    /allowlist/i,
  );

  let count = 0;
  let admissionPath = '';
  const admin = {
    database: () => ({
      ref: (path) => ({
        transaction: async (update) => {
          admissionPath = path;
          const next = update(count);
          if (next === undefined) return { committed: false };
          count = next;
          return { committed: true };
        },
      }),
    }),
  };
  const now = Date.UTC(2026, 6, 23, 18, 20);
  await consumeDurableAdmission({
    admin,
    release: '1.0.0-deadbeef',
    now,
    limit: 1,
  });
  await assert.rejects(
    consumeDurableAdmission({
      admin,
      release: '1.0.0-deadbeef',
      now,
      limit: 1,
    }),
    /rate limited/i,
  );
  assert.match(admissionPath, /admission\/days\/2026-07-23\/releases\/[^/]+\/hours\/18$/);
  assert.doesNotMatch(admissionPath, /user|room|agent|address|ip/i);
});

test('summary contract computes separate approximate p75 gates for mobile and desktop', () => {
  const snapshot = {
    release: '1.0.0-deadbeef',
    devices: {
      mobile: passingDevice(),
      desktop: {
        ...passingDevice(),
        metrics: {
          ...passingDevice().metrics,
          lcp: metricAggregate('lcp', 7),
        },
      },
    },
  };
  const summary = summarizeReleaseSnapshot(snapshot, {
    day: '2026-07-23',
    release: snapshot.release,
    minimumSamples: 75,
    generatedAt: 123,
  });
  assert.equal(summary.format, 'minimalist-rum-p75-v1');
  assert.equal(summary.devices.mobile.metrics.lcp.p75, 2500);
  assert.equal(summary.devices.desktop.metrics.lcp.p75, 4000);
  assert.equal(summary.gate.ready, true);
  assert.equal(summary.gate.passing, false);

  const gate = evaluateRumGate(summary);
  assert.equal(gate.passing, false);
  assert.equal(
    gate.checks.find((check) => check.deviceClass === 'desktop' && check.metric === 'lcp').status,
    'fail',
  );
});

test('gate fails a meaningful p75 regression even when the absolute ceiling still passes', () => {
  const baseline = summarizeReleaseSnapshot({
    release: '1.0.0-baseline',
    devices: {
      mobile: passingDevice(),
      desktop: passingDevice(),
    },
  }, {
    day: '2026-07-22',
    release: '1.0.0-baseline',
    minimumSamples: 75,
  });
  const current = structuredClone(baseline);
  current.release = '1.0.0-current';
  current.devices.mobile.metrics.lcp.p75 = 2400;
  current.devices.desktop.metrics.lcp.p75 = 2400;
  baseline.devices.mobile.metrics.lcp.p75 = 1200;
  baseline.devices.desktop.metrics.lcp.p75 = 1200;

  const gate = evaluateRumGate(current, { baseline });
  assert.equal(
    gate.checks.find((check) => (
      check.kind === 'threshold'
      && check.deviceClass === 'mobile'
      && check.metric === 'lcp'
    )).status,
    'pass',
  );
  const regression = gate.checks.find((check) => (
    check.kind === 'regression'
    && check.deviceClass === 'mobile'
    && check.metric === 'lcp'
  ));
  assert.equal(regression.threshold, 1350);
  assert.equal(regression.status, 'fail');
  assert.equal(gate.passing, false);
  assert.equal(gate.ready, true);
});

test('required release gate needs a matching current summary and a ready baseline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'minimalist-rum-gate-'));
  const currentFile = join(directory, 'current.json');
  const baselineFile = join(directory, 'baseline.json');
  const snapshot = {
    release: '1.0.0-current',
    devices: {
      mobile: passingDevice(),
      desktop: passingDevice(),
    },
  };
  const current = summarizeReleaseSnapshot(snapshot, {
    day: '2026-07-23',
    release: snapshot.release,
    minimumSamples: 75,
  });
  const baseline = summarizeReleaseSnapshot({
    ...snapshot,
    release: '1.0.0-baseline',
  }, {
    day: '2026-07-22',
    release: '1.0.0-baseline',
    minimumSamples: 75,
  });
  await Promise.all([
    writeFile(currentFile, JSON.stringify(current)),
    writeFile(baselineFile, JSON.stringify(baseline)),
  ]);
  const script = fileURLToPath(new URL('./rum-performance-gate.mjs', import.meta.url));
  const environment = {
    ...process.env,
    REQUIRE_RUM_PERFORMANCE_GATE: 'true',
    MINIMALIST_RUM_SUMMARY_FILE: currentFile,
    MINIMALIST_RUM_BASELINE_SUMMARY_FILE: baselineFile,
    MINIMALIST_RUM_RELEASE_ID: current.release,
  };

  try {
    const result = await execFileAsync(process.execPath, [script], { env: environment });
    assert.match(result.stdout, /regression: .* pass/);

    await assert.rejects(
      execFileAsync(process.execPath, [script], {
        env: {
          ...environment,
          MINIMALIST_RUM_BASELINE_SUMMARY_FILE: '',
        },
      }),
      /no baseline summary/i,
    );
    await assert.rejects(
      execFileAsync(process.execPath, [script], {
        env: {
          ...environment,
          MINIMALIST_RUM_RELEASE_ID: '1.0.0-different',
        },
      }),
      /does not match build/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('collector enforces origin, JSON, App Check middleware, and aggregate-only writes', async () => {
  let updates = null;
  let appCheckCalls = 0;
  const handler = createPerformanceRumHandler({
    admin: {
      database: () => ({
        ref: (path) => (path
          ? {
            transaction: async (update) => ({
              committed: update(0) !== undefined,
            }),
          }
          : {
            update: async (value) => {
              updates = value;
            },
          }),
      }),
    },
    ServerValue: {
      TIMESTAMP: { server: 'timestamp' },
      increment: (value) => ({ increment: value }),
    },
    setCors: () => {},
    allowedCorsOrigin: () => 'https://minimalist.chat',
    requireAppCheck: async () => {
      appCheckCalls += 1;
    },
    env: {
      PERFORMANCE_RUM_ACTIVE_RELEASES: '1.0.0-deadbeef',
      PERFORMANCE_RUM_HOURLY_LIMIT: '50000',
    },
    now: () => Date.UTC(2026, 6, 23),
  });
  const request = mockRequest({
    body: {
      schemaVersion: 1,
      release: '1.0.0-deadbeef',
      deviceClass: 'desktop',
      memoryTier: 'mid',
      metrics: { lcp: 2000 },
    },
    headers: {
      Origin: 'https://minimalist.chat',
      'Content-Type': 'application/json',
    },
  });
  const response = mockResponse();
  await handler(request, response);

  assert.equal(response.statusCode, 202);
  assert.equal(appCheckCalls, 1);
  assert.ok(updates);
  assert.doesNotMatch(JSON.stringify(updates), /minimalist\.chat|userAgent|pathname/i);
});

test('collector protects p75 summaries with a read token', async () => {
  const snapshotValue = {
    release: '1.0.0-deadbeef',
    devices: { mobile: passingDevice(), desktop: passingDevice() },
  };
  const handler = createPerformanceRumHandler({
    admin: {
      database: () => ({
        ref: () => ({
          once: async () => ({ val: () => snapshotValue }),
        }),
      }),
    },
    setCors: () => {},
    allowedCorsOrigin: () => 'https://minimalist.chat',
    env: {
      PERFORMANCE_RUM_READ_TOKEN: 'summary-secret',
      PERFORMANCE_RUM_MIN_SAMPLES: '75',
    },
    now: () => 123,
  });
  const response = mockResponse();
  await handler(mockRequest({
    method: 'GET',
    query: { day: '2026-07-23', release: '1.0.0-deadbeef' },
    headers: { Authorization: 'Bearer summary-secret' },
  }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.format, 'minimalist-rum-p75-v1');
  assert.equal(response.payload.gate.ready, true);
  assert.equal(response.payload.gate.passing, true);
});

test('startup files defer noncritical work and keep feature CSS activation explicit', async () => {
  const [
    index,
    loader,
    serviceWorker,
    chatBoot,
    roomLoaders,
    entryLoader,
    rumSource,
    offlineGenerator,
    packageSource,
    functionsSource,
    runtimeConfig,
    rumGate,
    deployScript,
    hostingPrepare,
    sourceRelease,
  ] = await Promise.all([
    projectFile('index.html'),
    projectFile('public/load-css.js'),
    projectFile('public/sw.js'),
    projectFile('src/features/shell/chatBoot.js'),
    projectFile('src/features/shell/roomFeatureLoaders.js'),
    projectFile('src/entry-loader.js'),
    projectFile('src/features/performance/realUserPerformance.js'),
    projectFile('tools/generate-offline-bootstrap.mjs'),
    projectFile('package.json'),
    projectFile('functions/index.js'),
    projectFile('public/config.js'),
    projectFile('tools/rum-performance-gate.mjs'),
    projectFile('tools/deploy-firebase-hourly.ps1'),
    projectFile('tools/prepare-hosting-publish.mjs'),
    projectFile('tools/source-release-id.mjs'),
  ]);

  assert.match(index, /<link rel="stylesheet" href="\/base\.css\?v=split40" data-minimalist-base-css="true"/);
  assert.doesNotMatch(index, /preload[^>]+base\.css/);
  assert.match(index, /<script defer src="\/load-css\.js\?v=8"><\/script>/);
  assert.match(loader, /minimalist:feature-styles-request/);
  assert.doesNotMatch(loader, /featureIdle|deferFeatureStyles/);
  assert.match(loader, /window\.__minimalistCssReady = Promise\.resolve\(\)/);
  assert.match(loader, /deferAppStylesAfterPaint/);
  assert.match(loader, /window\.addEventListener\('load', queueAfterLoad/);
  assert.doesNotMatch(chatBoot, /warmFeatureStyles/);
  assert.match(roomLoaders, /loadFeatureStyles\(\),\s+importOnce/);
  assert.match(entryLoader, /initializeRealUserPerformance\(\)/);
  assert.match(rumSource, /import\('web-vitals'\)/);
  assert.match(rumSource, /VITE_APP_RUM_RELEASE_ID/);
  assert.doesNotMatch(rumSource, /FINAL_FLUSH_MS|60_000/);
  assert.match(rumSource, /preloadAppCheckHeaders/);
  assert.match(functionsSource, /requirePerformanceRumAppCheck/);
  assert.match(functionsSource, /requireAppCheck:\s*requirePerformanceRumAppCheck/);
  assert.match(runtimeConfig, /performanceRum:\s*Boolean\(window\.FIREBASE_APP_CHECK_SITE_KEY\)/);
  assert.match(rumGate, /MINIMALIST_RUM_BASELINE_SUMMARY_(?:FILE|URL)/);
  assert.match(rumGate, /MINIMALIST_RUM_RELEASE_ID/);
  assert.doesNotMatch(deployScript, /Get-DeterministicSourceBuildNumber|New-PublishBuildNumber/);
  assert.match(deployScript, /MINIMALIST_HOSTING_PUBLISH_OWNER/);
  assert.match(hostingPrepare, /REQUIRE_RUM_PERFORMANCE_GATE: 'true'/);
  assert.match(hostingPrepare, /resolveSourceBuildNumber/);
  assert.match(hostingPrepare, /resolveRumReleaseId/);
  assert.match(sourceRelease, /BUILD_SOURCE_PATHS/);

  assert.match(serviceWorker, /'\/config\.js\?v=localai7'/);
  assert.match(serviceWorker, /'\/load-css\.js\?v=8'/);
  assert.match(serviceWorker, /cacheBootstrapAssets/);
  assert.match(serviceWorker, /OFFLINE_BOOTSTRAP_MANIFEST/);
  assert.match(serviceWorker, /SERVICE_WORKER_BUILD/);
  assert.match(serviceWorker, /prepareNavigation/);
  assert.match(serviceWorker, /navigationBootstrapKey/);
  assert.doesNotMatch(serviceWorker, /pruneObsoleteBootstrapAssets/);
  assert.match(serviceWorker, /cacheAppShell\(\)\.then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(serviceWorker, /prunePreviousCachesWhenClientsMatchBuild/);
  assert.doesNotMatch(serviceWorker, /timeoutMs:\s*3000/);
  assert.match(offlineGenerator, /src\/features\/shell\/chatApp\.js/);
  assert.match(offlineGenerator, /src\/features\/chat-core\/MessageTimeline\.jsx/);
  assert.match(offlineGenerator, /src\/features\/chat-core\/QuickReplies\.jsx/);
  assert.match(offlineGenerator, /\['chat-core', 'quick-replies'\]/);
  assert.match(packageSource, /generate-offline-bootstrap\.mjs/);
  assert.doesNotMatch(index, /★|\+ New room|\+ Channel|✅/);
});
