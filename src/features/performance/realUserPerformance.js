const RUM_SCHEMA_VERSION = 1;
const DEFAULT_ENDPOINT = '/api/performance/vitals';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const REAL_USER_THRESHOLDS = Object.freeze({
  lcp: 2500,
  inp: 200,
  cls: 0.1,
});

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMetric(name, value) {
  const number = finiteNumber(value);
  if (number === null || number < 0) return null;
  return name === 'cls'
    ? Math.round(number * 10_000) / 10_000
    : Math.round(number);
}

export function resolveDeviceClass({
  viewportWidth,
  userAgentDataMobile = false,
} = {}) {
  const width = finiteNumber(viewportWidth);
  return userAgentDataMobile || (width !== null && width <= 768) ? 'mobile' : 'desktop';
}

export function resolveMemoryTier({
  deviceMemory,
  jsHeapSizeLimit,
} = {}) {
  const memory = finiteNumber(deviceMemory);
  if (memory !== null && memory > 0) {
    if (memory <= 2) return 'low';
    if (memory <= 4) return 'mid';
    return 'high';
  }

  const heapLimit = finiteNumber(jsHeapSizeLimit);
  if (heapLimit !== null && heapLimit > 0) {
    const mebibytes = heapLimit / (1024 * 1024);
    if (mebibytes <= 512) return 'low';
    if (mebibytes <= 1536) return 'mid';
    return 'high';
  }
  return 'unknown';
}

export function normalizeRumRelease(version, buildNumber) {
  const clean = (value, maxLength = 32) => String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9_-]+/, '')
    .slice(0, maxLength);
  const appVersion = clean(version) || 'unknown';
  const build = clean(buildNumber, 64);
  return (build && build !== appVersion ? `${appVersion}-${build}` : appVersion).slice(0, 64);
}

export function createRumPayload({
  release,
  deviceClass,
  memoryTier,
  metrics,
}) {
  const normalizedMetrics = {};
  for (const [name, value] of Object.entries(metrics || {})) {
    const rounded = roundMetric(name, value);
    if (rounded !== null) normalizedMetrics[name] = rounded;
  }
  return {
    schemaVersion: RUM_SCHEMA_VERSION,
    release,
    deviceClass,
    memoryTier,
    metrics: normalizedMetrics,
  };
}

function configuredSampleRate(windowObject) {
  const configured = finiteNumber(windowObject.MINIMALIST_RUM_SAMPLE_RATE);
  if (configured === null) return 1;
  return Math.max(0, Math.min(1, configured));
}

function canSendFromLocation(locationObject) {
  return locationObject
    && /^https?:$/.test(locationObject.protocol)
    && !LOCAL_HOSTS.has(locationObject.hostname);
}

function appCheckConfigured(windowObject) {
  return Boolean(String(windowObject?.FIREBASE_APP_CHECK_SITE_KEY || '').trim());
}

export async function sendRumPayload(payload, {
  endpoint,
  fetchImpl,
  locationObject,
  windowObject,
  loadAppCheckHeaders,
}) {
  if (!Object.keys(payload.metrics).length || !canSendFromLocation(locationObject)) return false;
  if (!appCheckConfigured(windowObject)) return false;

  let appCheckHeaders;
  try {
    appCheckHeaders = await loadAppCheckHeaders();
  } catch {
    return false;
  }
  if (!String(appCheckHeaders?.['X-Firebase-AppCheck'] || '').trim()) return false;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...appCheckHeaders,
      },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    return response.ok;
  } catch {
    return false;
  }
}

function loadWebVitalsAfterInteraction({
  windowObject,
  documentObject,
  isChatRoute,
  loadWebVitals,
  start,
}) {
  let scheduled = false;
  let fallbackTimer = 0;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    windowObject.clearTimeout(fallbackTimer);
    const load = () => Promise.resolve()
      .then(loadWebVitals)
      .then(start)
      .catch(() => undefined);
    if (typeof windowObject.requestIdleCallback === 'function') {
      windowObject.requestIdleCallback(load, { timeout: 3000 });
    } else {
      windowObject.setTimeout(load, 80);
    }
  };

  if (isChatRoute) {
    windowObject.addEventListener('minimalist:chat-interactive', schedule, { once: true });
    fallbackTimer = windowObject.setTimeout(schedule, 8000);
  } else if (documentObject.readyState === 'complete') {
    schedule();
  } else {
    windowObject.addEventListener('load', schedule, { once: true });
    fallbackTimer = windowObject.setTimeout(schedule, 5000);
  }
}

export function createRealUserPerformanceMonitor({
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  navigatorObject = globalThis.navigator,
  performanceObject = globalThis.performance,
  PerformanceObserverClass = globalThis.PerformanceObserver,
  fetchImpl = globalThis.fetch,
  loadWebVitals = () => import('web-vitals'),
  loadAppCheckHeaders = () => import('../../lib/firebase.js')
    .then(({ getAppCheckHeaders }) => getAppCheckHeaders()),
  random = Math.random,
  release = import.meta.env?.VITE_APP_RUM_RELEASE_ID
    || normalizeRumRelease(
      import.meta.env?.VITE_APP_VERSION,
      import.meta.env?.VITE_APP_BUILD_NUMBER,
    ),
  endpoint,
} = {}) {
  if (!windowObject || !documentObject || !navigatorObject || !performanceObject) return null;
  if (navigatorObject.globalPrivacyControl === true) return null;
  if (windowObject.MINIMALIST_FLAGS?.performanceRum === false) return null;
  if (!appCheckConfigured(windowObject)) return null;
  const sampleRate = configuredSampleRate(windowObject);
  if (sampleRate <= 0 || random() >= sampleRate) return null;

  const path = String(windowObject.location?.pathname || '/');
  const isChatRoute = /^\/(?:chat|join)(?:\/|$)/.test(path);
  const metrics = {
    long_task_total: 0,
    long_task_max: 0,
    long_task_count: 0,
  };
  const observers = [];
  let submitted = false;
  let appCheckHeadersPromise = null;

  const preloadAppCheckHeaders = () => {
    if (!appCheckHeadersPromise) {
      appCheckHeadersPromise = Promise.resolve()
        .then(loadAppCheckHeaders)
        .catch(() => ({}));
    }
    return appCheckHeadersPromise;
  };

  const currentAppCheckHeaders = async () => {
    if (appCheckHeadersPromise) await appCheckHeadersPromise;
    return loadAppCheckHeaders();
  };

  const queueAppCheckPreload = () => {
    const preload = () => {
      void preloadAppCheckHeaders();
    };
    if (typeof windowObject.requestIdleCallback === 'function') {
      windowObject.requestIdleCallback(preload, { timeout: 3000 });
    } else {
      windowObject.setTimeout(preload, 250);
    }
  };

  const recordWebVital = (metric) => {
    const name = String(metric?.name || '').toLowerCase();
    if (!Object.hasOwn(REAL_USER_THRESHOLDS, name)) return;
    const value = roundMetric(name, metric.value);
    if (value !== null) metrics[name] = value;
  };

  const startWebVitals = ({ onCLS, onINP, onLCP }) => {
    const options = { reportAllChanges: true };
    onCLS(recordWebVital, options);
    onINP(recordWebVital, options);
    onLCP(recordWebVital, options);
  };

  if (PerformanceObserverClass?.supportedEntryTypes?.includes('longtask')) {
    try {
      const observer = new PerformanceObserverClass((list) => {
        for (const entry of list.getEntries()) {
          const duration = Math.max(0, finiteNumber(entry.duration) || 0);
          metrics.long_task_count += 1;
          metrics.long_task_total += duration;
          metrics.long_task_max = Math.max(metrics.long_task_max, duration);
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      observers.push(observer);
    } catch {
      // Long Task timing is optional and absent in several supported browsers.
    }
  }

  const markChatReady = () => {
    metrics.chat_ready = Math.max(0, Math.round(performanceObject.now()));
  };
  if (isChatRoute) {
    windowObject.addEventListener('minimalist:chat-interactive', markChatReady, { once: true });
  }

  const deviceClass = resolveDeviceClass({
    viewportWidth: windowObject.innerWidth,
    userAgentDataMobile: navigatorObject.userAgentData?.mobile === true,
  });
  const memoryTier = resolveMemoryTier({
    deviceMemory: navigatorObject.deviceMemory,
    jsHeapSizeLimit: performanceObject.memory?.jsHeapSizeLimit,
  });

  const snapshot = () => createRumPayload({
    release,
    deviceClass,
    memoryTier,
    metrics,
  });

  const submit = () => {
    if (submitted) return;
    submitted = true;
    observers.forEach((observer) => observer.disconnect());
    const payload = snapshot();
    if (windowObject.CustomEvent) {
      windowObject.dispatchEvent(new windowObject.CustomEvent('minimalist:performance-sample', {
        detail: payload,
      }));
    }
    void sendRumPayload(payload, {
      endpoint: endpoint || windowObject.PERFORMANCE_RUM_ENDPOINT || DEFAULT_ENDPOINT,
      fetchImpl,
      locationObject: windowObject.location,
      windowObject,
      loadAppCheckHeaders: currentAppCheckHeaders,
    });
  };
  const submitAfterVitalCallbacks = () => {
    if (typeof windowObject.queueMicrotask === 'function') windowObject.queueMicrotask(submit);
    else Promise.resolve().then(submit);
  };

  documentObject.addEventListener('visibilitychange', () => {
    if (documentObject.visibilityState === 'hidden') submitAfterVitalCallbacks();
  });
  windowObject.addEventListener('pagehide', submitAfterVitalCallbacks, { once: true });
  queueAppCheckPreload();

  loadWebVitalsAfterInteraction({
    windowObject,
    documentObject,
    isChatRoute,
    loadWebVitals,
    start: startWebVitals,
  });

  return Object.freeze({
    snapshot,
    submit,
  });
}

let activeMonitor;

export function initializeRealUserPerformance() {
  if (activeMonitor !== undefined) return activeMonitor;
  activeMonitor = createRealUserPerformanceMonitor();
  if (activeMonitor) {
    window.__minimalistPerformanceSnapshot = activeMonitor.snapshot;
  }
  return activeMonitor;
}
