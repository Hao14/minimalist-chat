import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faqItems, termsSections } from '../src/content/marketingContent.js';

const DEFAULT_PORT = Number(process.env.UI_SMOKE_PORT || 4173);
const BASE_URL = String(process.env.UI_SMOKE_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/$/, '');
const USE_EXISTING_SERVER = Boolean(process.env.UI_SMOKE_BASE_URL);
const REQUIRE_GOOGLE_BUTTON = !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE_URL);
const CHROME_DEBUG_PORT = Number(process.env.UI_SMOKE_CHROME_PORT || 9339);
const TIMEOUT_MS = Number(process.env.UI_SMOKE_TIMEOUT_MS || 30000);
const STARTUP_ONLY = process.env.UI_SMOKE_STARTUP_ONLY === '1';

const viewports = [
  { name: 'desktop', width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
];

const routes = ['/', '/features', '/pricing', '/download', '/story', '/faq', '/privacy', '/terms', '/login', '/chat', '/seo-smoke-missing'];
const indexableRoutes = new Set(['/', '/features', '/pricing', '/download', '/story', '/faq', '/privacy', '/terms']);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let chromeProfileDir = '';

function debug(message) {
  if (process.env.UI_SMOKE_DEBUG === '1') console.error(`[ui-smoke] ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(fn, label, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function requestWithTimeout(url, options = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(target, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => JSON.parse(body || '{}'),
          text: async () => body,
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request to ${url} timed out`));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitForHttp(url, label) {
  return waitFor(async () => {
    const response = await requestWithTimeout(url);
    return response.ok;
  }, label);
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function chromeCandidates() {
  return [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
}

function findChrome() {
  const found = chromeCandidates().find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Chrome was not found. Set CHROME_PATH to run UI smoke tests.');
  }
  return found;
}

function startPreviewServer() {
  if (USE_EXISTING_SERVER) return null;
  debug(`starting preview server at ${BASE_URL}`);
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npmCommand();
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run preview -- --host 127.0.0.1 --port ${DEFAULT_PORT} --strictPort`]
    : ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(DEFAULT_PORT), '--strictPort'];
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

function startChrome() {
  chromeProfileDir = mkdtempSync(path.join(tmpdir(), 'minimalist-ui-smoke-'));
  const chromePath = findChrome();
  debug(`starting Chrome from ${chromePath} on port ${CHROME_DEBUG_PORT}`);
  const child = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${chromeProfileDir}`,
    'about:blank',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  child.on('exit', (code, signal) => debug(`Chrome exited code=${code} signal=${signal}`));
  return child;
}

async function newPageWebSocketUrl() {
  const targetUrl = `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/new?about:blank`;
  const response = await requestWithTimeout(targetUrl, { method: 'PUT' });
  if (!response.ok) throw new Error(`Could not create Chrome tab (${response.status})`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error('Chrome tab did not expose a debugger URL.');
  return target.webSocketDebuggerUrl;
}

class CdpSession {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.ws = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.errors = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => this.onMessage(event.data));
  }

  onMessage(raw) {
    const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
    const message = JSON.parse(text);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject, timeoutId } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timeoutId);
      if (message.error) reject(new Error(message.error.message || 'CDP command failed'));
      else resolve(message.result || {});
      return;
    }

    this.events.push(message);
    if (message.method === 'Runtime.exceptionThrown') {
      this.errors.push({
        level: 'error',
        source: 'exception',
        message: message.params?.exceptionDetails?.text || message.params?.exceptionDetails?.exception?.description || 'Runtime exception',
      });
    }
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params?.type)) {
      this.errors.push({
        level: 'error',
        source: 'console',
        message: (message.params.args || []).map((arg) => arg.value || arg.description || '').join(' ').slice(0, 500),
      });
    }
    if (message.method === 'Log.entryAdded' && ['error'].includes(message.params?.entry?.level)) {
      this.errors.push({
        level: 'error',
        source: 'log',
        message: String(message.params.entry.text || '').slice(0, 500),
      });
    }
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, Math.max(10000, TIMEOUT_MS));
      this.pending.set(id, { resolve, reject, timeoutId });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setup() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Network.enable');
  }

  async setViewport(viewport) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: viewport.mobile,
    });
    await this.send('Emulation.setTouchEmulationEnabled', viewport.mobile
      ? { enabled: true, maxTouchPoints: 5 }
      : { enabled: false });
  }

  async navigate(url) {
    this.errors = [];
    const navigation = await this.send('Page.navigate', { url });
    await delay(900);

    // Chrome can transiently expose chrome-error://chromewebdata for a
    // deliberate 404 navigation before the service-worker fallback claims it.
    // Retry that transport failure once; persistent failures still surface in
    // the route assertions below.
    let currentUrl = await this.evaluate('location.href').catch(() => '');
    if (navigation.errorText || currentUrl.startsWith('chrome-error://')) {
      this.errors = [];
      await delay(250);
      await this.send('Page.navigate', { url });
      await delay(900);
      currentUrl = await this.evaluate('location.href').catch(() => '');
    }

    // Vite preview occasionally returns its empty transport-level 404 instead
    // of the built custom 404 document. Hosting semantics are covered by the
    // Firebase SEO smoke test; keep this visual smoke deterministic by opening
    // the exact built fallback when that preview-only response occurs.
    if (currentUrl.startsWith('chrome-error://') && new URL(url).pathname === '/seo-smoke-missing') {
      this.errors = [];
      await this.send('Page.navigate', { url: `${BASE_URL}/404.html` });
      await delay(900);
      currentUrl = await this.evaluate('location.href').catch(() => '');
    }

    if (currentUrl.startsWith('chrome-error://')) return;

    const settledDeadline = Date.now() + Math.min(TIMEOUT_MS, 10000);
    while (Date.now() < settledDeadline) {
      const settled = await this.evaluate(`(() => {
        const visible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden';
        };
        const root = document.getElementById('root');
        return document.readyState === 'complete'
          && Boolean(root)
          && !root.querySelector('#static-home-shell, [data-prerender-route], .route-loading')
          && [...root.querySelectorAll('main')].some(visible)
          && [...root.querySelectorAll('h1')].some(visible);
      })()`).catch(() => false);
      if (settled) return;
      await delay(100);
    }
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Evaluation failed');
    }
    return result.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // best effort
    }
  }
}

async function traceLandingStartup(session, viewport) {
  const marker = `${viewport.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const transitions = [];
  let sampleCount = 0;
  let finalState = null;
  let sawBlankFrame = false;
  let sawStaticHome = false;
  let contextReadyObserved = false;
  const startedAt = Date.now();

  await session.setViewport(viewport);
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 80,
    downloadThroughput: 1_500_000,
    uploadThroughput: 750_000,
    connectionType: 'cellular4g',
  });
  session.errors = [];

  try {
    const navigationEventIndex = session.events.length;
    const navigation = await session.send('Page.navigate', { url: `${BASE_URL}/?startup-smoke=${encodeURIComponent(marker)}` });
    const deadline = Date.now() + Math.min(TIMEOUT_MS, 15000);

    while (Date.now() < deadline) {
      contextReadyObserved = session.events
        .slice(navigationEventIndex)
        .some((event) => event.method === 'Runtime.executionContextCreated'
          && event.params?.context?.auxData?.isDefault
          && (!navigation.frameId || event.params.context.auxData.frameId === navigation.frameId));
      if (contextReadyObserved) break;
      await delay(20);
    }

    while (Date.now() < deadline) {
      let state = null;
      try {
        state = await session.evaluate(`(() => {
          if (new URLSearchParams(location.search).get('startup-smoke') !== ${JSON.stringify(marker)}) return null;
          const visible = (element) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0
              && rect.height > 0
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && rect.bottom >= 0
              && rect.right >= 0
              && rect.left <= innerWidth
              && rect.top <= innerHeight;
          };
          const visibleCount = (selector) => [...document.querySelectorAll(selector)].filter(visible).length;
          const reactHome = document.querySelector('main.landing-v3.home-v5');
          const icon = [...document.querySelectorAll('.ph-bold')].find(visible);
          const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
          return {
            pending: document.documentElement.classList.contains('home-react-pending'),
            staticPresent: Boolean(document.getElementById('static-home-shell')),
            staticVisible: visible(document.getElementById('static-home-shell')),
            reactVisible: visible(reactHome),
            fallbackVisible: visible(document.querySelector('.route-loading')),
            bootVisible: visible(document.getElementById('app-boot-shell')),
            visibleMainCount: visibleCount('main'),
            visibleH1Count: visibleCount('h1'),
            iconFontReady: !icon || (
              getComputedStyle(icon).fontFamily.includes('Phosphor-Bold-Subset')
              && (document.fonts?.check('1em "Phosphor-Bold-Subset"') ?? true)
            ),
            overflowX: documentWidth > document.documentElement.clientWidth + 2,
          };
        })()`);
      } catch {
        // Navigation swaps execution contexts. Sample the new context next tick.
      }

      if (state) {
        sampleCount += 1;
        if (!state.reactVisible && state.staticVisible) {
          sawStaticHome = true;
        }
        if (state.staticPresent && !state.reactVisible && !state.staticVisible && !state.fallbackVisible && !state.bootVisible) {
          sawBlankFrame = true;
        }
        const signature = [
          state.pending,
          state.staticPresent,
          state.staticVisible,
          state.reactVisible,
          state.fallbackVisible,
          state.bootVisible,
          state.visibleMainCount,
          state.visibleH1Count,
          state.iconFontReady,
          state.overflowX,
        ].join('|');
        if (transitions.at(-1)?.signature !== signature) {
          transitions.push({
            atMs: Date.now() - startedAt,
            signature,
            ...state,
          });
        }
        if (state.reactVisible && !state.pending) {
          finalState = state;
          break;
        }
      }

      await delay(20);
    }
  } finally {
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none',
    });
    await session.send('Network.setCacheDisabled', { cacheDisabled: false });
  }

  const startupErrors = session.errors.slice();
  return {
    step: `landing startup keeps a meaningful surface until final React home (${viewport.name})`,
    ok: Boolean(
      contextReadyObserved
      && sampleCount > 0
      && sawStaticHome
      && !sawBlankFrame
      && finalState?.reactVisible
      && finalState.visibleMainCount === 1
      && finalState.visibleH1Count === 1
      && finalState.iconFontReady
      && !finalState.overflowX
      && startupErrors.length === 0
    ),
    viewport: viewport.name,
    sampleCount,
    settledMs: finalState ? Date.now() - startedAt : null,
    contextReadyObserved,
    sawStaticHome,
    sawBlankFrame,
    finalState,
    transitions,
    startupErrors,
  };
}

function pageStateExpression(route, viewportName) {
  return `(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth || 0, body?.scrollWidth || 0);
    const clientWidth = doc.clientWidth || window.innerWidth;
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && rect.bottom >= 0 && rect.right >= 0 && rect.left <= window.innerWidth && rect.top <= window.innerHeight;
    };
    const controls = [...document.querySelectorAll('button, a[href], input, textarea, select, [role="button"]')]
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('href') || el.id || el.className || el.tagName).toString().replace(/\\s+/g, ' ').trim();
        // The embedded desktop demo intentionally scales authentic app chrome down.
        // Exercise its controls below, but keep them out of the marketing tap-target audit.
        const primary = !el.closest('#home-live-demo') && el.matches('button, input, textarea, select, [role="button"], .nav-cta, .mobile-signup-link');
        return { text: text.slice(0, 80), tag: el.tagName.toLowerCase(), width: Math.round(rect.width), height: Math.round(rect.height), primary };
      });
    return {
      route: ${JSON.stringify(route)},
      viewport: ${JSON.stringify(viewportName)},
      url: location.href,
      title: document.title,
      bodyLength: (body?.innerText || '').trim().length,
      overflowX: scrollWidth > clientWidth + 2,
      scrollWidth,
      clientWidth,
      crashOverlay: Boolean(document.querySelector('[vite-error-overlay], .vite-error-overlay, .error-overlay, .script-crash, [data-crash]')) || (body?.innerText || '').includes('Script Crash'),
      googleButtonMounted: Boolean(document.querySelector('.google-identity-button iframe, .google-identity-shell')),
      visibleMainCount: [...document.querySelectorAll('main')].filter(visible).length,
      visibleH1Count: [...document.querySelectorAll('h1')].filter(visible).length,
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      ogUrl: document.querySelector('meta[property="og:url"]')?.content || '',
      pricingContractVisible: ['Base', 'Advanced', 'Pro', '$1.99/month', '$7.99/month', 'Advanced Room', '$11.99/month', 'Pro Room', '$19.99/month']
        .every((value) => (body?.innerText || '').includes(value)),
      faqCount: document.querySelectorAll('.mkt4-faq-list details').length,
      termsSectionCount: document.querySelectorAll('.terms-v5 .mkt4-legal-section').length,
      notFoundVisible: Boolean(document.querySelector('.not-found-page h1')) && (body?.innerText || '').includes('Return Home'),
      controlsCount: controls.length,
      smallPrimaryControls: controls.filter((control) => control.primary && (control.width < 40 || control.height < 40)).slice(0, 12),
    };
  })()`;
}

function clickExpression(selector) {
  return `(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(visible);
    if (!el) return { ok: false, selector: ${JSON.stringify(selector)} };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return { ok: true, selector: ${JSON.stringify(selector)}, text: (el.innerText || el.getAttribute('aria-label') || el.href || '').trim() };
  })()`;
}

function fillExpression(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return { ok: false, selector: ${JSON.stringify(selector)} };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return { ok: false, selector: ${JSON.stringify(selector)} };
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, selector: ${JSON.stringify(selector)}, value: input.value };
  })()`;
}

function clickTextExpression(selector, expectedText) {
  return `(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const expected = ${JSON.stringify(expectedText)};
    const expectedNormalized = normalize(expected).toLocaleLowerCase();
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => visible(candidate) && normalize(candidate.innerText || candidate.getAttribute('aria-label')).toLocaleLowerCase().includes(expectedNormalized));
    if (!el) return { ok: false, selector: ${JSON.stringify(selector)}, expected };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return { ok: true, selector: ${JSON.stringify(selector)}, expected, text: normalize(el.innerText || el.getAttribute('aria-label')) };
  })()`;
}

function setInputExpression(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return { ok: false, selector: ${JSON.stringify(selector)} };
    input.scrollIntoView({ block: 'center', inline: 'center' });
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return { ok: false, selector: ${JSON.stringify(selector)}, reason: 'value setter unavailable' };
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, selector: ${JSON.stringify(selector)}, value: input.value };
  })()`;
}

function demoStateExpression(viewportName) {
  return `(() => {
    const demo = document.querySelector('#home-live-demo');
    const doc = document.documentElement;
    const body = document.body;
    const pageScrollWidth = Math.max(doc.scrollWidth || 0, body?.scrollWidth || 0);
    const pageClientWidth = doc.clientWidth || innerWidth;
    if (!demo) {
      return {
        exists: false,
        viewport: ${JSON.stringify(viewportName)},
        pageOverflowX: pageScrollWidth > pageClientWidth + 2,
        pageScrollWidth,
        pageClientWidth,
      };
    }
    const rect = demo.getBoundingClientRect();
    const activeRoom = demo.querySelector('.desktop-demo-room-list button[aria-pressed="true"]');
    const activeTab = demo.querySelector('.desktop-demo-tabs [role="tab"][aria-selected="true"]');
    const activeChannel = demo.querySelector('.desktop-demo-channels button[aria-pressed="true"]');
    const input = demo.querySelector('input[aria-label="Type a demo message"]');
    return {
      exists: true,
      viewport: ${JSON.stringify(viewportName)},
      pageOverflowX: pageScrollWidth > pageClientWidth + 2,
      pageScrollWidth,
      pageClientWidth,
      demoOverflowX: demo.scrollWidth > demo.clientWidth + 2,
      demoWithinViewport: rect.left >= -2 && rect.right <= innerWidth + 2,
      roomName: demo.querySelector('.desktop-demo-room-header strong')?.textContent?.trim() || '',
      activeRoom: activeRoom?.querySelector('strong')?.textContent?.replace('★', '')?.trim() || '',
      activeTab: activeTab?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      activeChannel: activeChannel?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      inputValue: input?.value ?? null,
      messageCount: demo.querySelectorAll('.desktop-demo-messages .desktop-demo-message').length,
      messageTexts: [...demo.querySelectorAll('.desktop-demo-message-body p')].map((node) => node.textContent?.trim() || ''),
      tasksVisible: Boolean(demo.querySelector('.desktop-demo-task-panel[aria-label="Tasks"]')),
      status: demo.querySelector('.desktop-demo-status')?.textContent?.trim() || '',
    };
  })()`;
}

async function inspectRoute(session, viewport, route) {
  await session.navigate(`${BASE_URL}${route}`);
  if (route === '/chat') await delay(800);
  if (route === '/faq') {
    await waitFor(
      () => session.evaluate(`document.querySelectorAll('.mkt4-faq-list details').length === ${faqItems.length}`),
      `${viewport.name} FAQ content`,
      Math.min(TIMEOUT_MS, 15000),
    );
  }
  if (route === '/terms') {
    await waitFor(
      () => session.evaluate(`document.querySelectorAll('.terms-v5 .mkt4-legal-section').length === ${termsSections.length}`),
      `${viewport.name} Terms content`,
      Math.min(TIMEOUT_MS, 15000),
    );
  }
  const state = await session.evaluate(pageStateExpression(route, viewport.name));
  const failures = [];
  if (!state.bodyLength) failures.push('blank body');
  if (state.overflowX) failures.push(`horizontal overflow ${state.scrollWidth}/${state.clientWidth}`);
  if (state.crashOverlay) failures.push('crash overlay visible');
  if (state.visibleMainCount !== 1) failures.push(`expected one visible main, found ${state.visibleMainCount}`);
  if (state.visibleH1Count !== 1) failures.push(`expected one visible H1, found ${state.visibleH1Count}`);
  if (indexableRoutes.has(route)) {
    const expectedCanonical = route === '/' ? 'https://minimalist.chat/' : `https://minimalist.chat${route}`;
    if (state.canonical !== expectedCanonical) failures.push(`canonical mismatch: ${state.canonical || '(missing)'}`);
    if (state.ogUrl !== expectedCanonical) failures.push(`og:url mismatch: ${state.ogUrl || '(missing)'}`);
  }
  if (route === '/pricing' && !state.pricingContractVisible) failures.push('verified pricing contract is not fully visible');
  if (route === '/faq' && state.faqCount !== faqItems.length) failures.push(`expected ${faqItems.length} FAQ rows, found ${state.faqCount}`);
  if (route === '/terms' && state.termsSectionCount !== termsSections.length) failures.push(`expected ${termsSections.length} Terms sections, found ${state.termsSectionCount}`);
  if (route === '/seo-smoke-missing' && !state.notFoundVisible) failures.push('branded not-found page is not visible');
  if (route === '/chat' && !state.url.includes('/login')) failures.push('signed-out /chat did not redirect to login');
  if (route === '/login' && REQUIRE_GOOGLE_BUTTON && !state.googleButtonMounted) failures.push('Google sign-in button was not mounted');
  if (state.smallPrimaryControls.length) failures.push(`small primary controls: ${state.smallPrimaryControls.map((control) => `${control.text || control.tag} ${control.width}x${control.height}`).join('; ')}`);
  if (session.errors.length) failures.push(`console/runtime errors: ${session.errors.map((entry) => entry.message).join(' | ')}`);
  return { ...state, ok: failures.length === 0, failures };
}

async function testInteractions(session) {
  const results = [];
  await session.setViewport(viewports[0]);
  await session.navigate(`${BASE_URL}/`);
  let demoState = await session.evaluate(demoStateExpression('desktop'));
  results.push({
    step: 'landing demo exists on desktop without overflow',
    ok: demoState.exists && !demoState.pageOverflowX && !demoState.demoOverflowX && demoState.demoWithinViewport,
    demoState,
  });

  let clicked = await session.evaluate(clickTextExpression('.desktop-demo-room-list button', 'Global Chat'));
  await delay(150);
  demoState = await session.evaluate(demoStateExpression('desktop'));
  results.push({
    step: 'landing demo room switch changes active room',
    ok: clicked.ok && demoState.activeRoom === 'Global Chat' && demoState.roomName === 'Global Chat' && demoState.activeTab === 'Chat',
    clicked,
    demoState,
  });

  const homeClicked = await session.evaluate(clickTextExpression('.desktop-demo-room-list button', 'HOME'));
  await delay(150);
  const tasksClicked = await session.evaluate(clickTextExpression('.desktop-demo-tabs [role="tab"]', 'Tasks'));
  await delay(150);
  const tasksState = await session.evaluate(demoStateExpression('desktop'));
  const chatClicked = await session.evaluate(clickTextExpression('.desktop-demo-tabs [role="tab"]', 'Chat'));
  await delay(150);
  const chatState = await session.evaluate(demoStateExpression('desktop'));
  results.push({
    step: 'landing demo Chat and Tasks tabs change state',
    ok: homeClicked.ok && tasksClicked.ok && tasksState.activeTab === 'Tasks' && tasksState.tasksVisible && chatClicked.ok && chatState.activeTab === 'Chat' && !chatState.tasksVisible,
    homeClicked,
    tasksClicked,
    tasksState,
    chatClicked,
    chatState,
  });

  const localMessage = 'Local smoke message';
  const inputSet = await session.evaluate(setInputExpression('#home-live-demo input[aria-label="Type a demo message"]', localMessage));
  await delay(150);
  clicked = await session.evaluate(clickExpression('#home-live-demo button[aria-label="Send demo message"]'));
  await delay(200);
  const sentState = await session.evaluate(demoStateExpression('desktop'));
  results.push({
    step: 'landing demo local send clears input and adds message',
    ok: inputSet.ok && clicked.ok && sentState.inputValue === '' && sentState.messageTexts.includes(localMessage) && sentState.status === 'Message added to the local demo.',
    inputSet,
    clicked,
    sentState,
  });

  await session.evaluate(clickTextExpression('.desktop-demo-tabs [role="tab"]', 'Tasks'));
  await delay(100);
  clicked = await session.evaluate(clickExpression('#home-live-demo button[aria-label="Reset demo"]'));
  await delay(200);
  const resetState = await session.evaluate(demoStateExpression('desktop'));
  results.push({
    step: 'landing demo reset restores initial state',
    ok: clicked.ok
      && resetState.activeRoom === 'HOME'
      && resetState.roomName === 'HOME'
      && resetState.activeTab === 'Chat'
      && resetState.activeChannel === '# general'
      && resetState.inputValue === ''
      && resetState.messageCount === 2
      && !resetState.messageTexts.includes(localMessage)
      && resetState.status === 'Demo reset.',
    clicked,
    resetState,
  });

  await session.navigate(`${BASE_URL}/`);
  await waitFor(
    () => session.evaluate('Boolean(document.querySelector(\'.landing-text-link[href="/pricing"]\'))'),
    'hydrated homepage Compare plans link',
  );
  await session.evaluate(`(() => {
    const section = document.querySelector('.landing-text-link[href="/pricing"]')?.closest('.landing-close');
    section?.scrollIntoView({ block: 'center', inline: 'nearest' });
    return Boolean(section);
  })()`);
  await waitFor(
    () => session.evaluate(`(() => {
      const link = document.querySelector('.landing-text-link[href="/pricing"]');
      if (!link) return false;
      const rect = link.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })()`),
    'rendered homepage Compare plans link',
  );
  clicked = await session.evaluate(clickTextExpression('.landing-text-link[href="/pricing"]', 'Compare plans'));
  await delay(600);
  let href = await session.evaluate('location.pathname');
  const pricingState = await session.evaluate(pageStateExpression('/pricing', 'desktop'));
  results.push({
    step: 'homepage Compare plans reaches truthful pricing',
    ok: clicked.ok
      && href === '/pricing'
      && pricingState.pricingContractVisible
      && pricingState.visibleH1Count === 1
      && !pricingState.overflowX,
    href,
    clicked,
    pricingState,
  });

  await session.navigate(`${BASE_URL}/faq`);
  await waitFor(
    () => session.evaluate(`document.querySelectorAll('.mkt4-faq-list details').length === ${faqItems.length}`),
    'interactive FAQ content',
    Math.min(TIMEOUT_MS, 15000),
  );
  const faqSearchFilled = await session.evaluate(fillExpression('#faq-search', 'delete account'));
  await delay(150);
  const faqSearchState = await session.evaluate(`(() => ({
    count: document.querySelectorAll('.mkt4-faq-list details').length,
    question: document.querySelector('.mkt4-faq-list summary strong')?.textContent?.trim() || '',
  }))()`);
  await session.evaluate(fillExpression('#faq-search', ''));
  await delay(150);
  const faqClicked = await session.evaluate(clickExpression('.mkt4-faq-list details:nth-of-type(2) summary'));
  await delay(150);
  const faqState = await session.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.mkt4-faq-list details')];
    const opened = rows[1];
    return {
      count: rows.length,
      opened: Boolean(opened?.open),
      answer: opened?.querySelector('p')?.textContent?.trim() || '',
    };
  })()`);
  results.push({
    step: 'FAQ search and accordion expose shared interactive answers',
    ok: faqSearchFilled.ok
      && faqSearchState.count === 1
      && faqSearchState.question === 'What happens when I delete my account?'
      && faqClicked.ok
      && faqState.count === faqItems.length
      && faqState.opened
      && faqState.answer.length > 20,
    faqSearchFilled,
    faqSearchState,
    faqClicked,
    faqState,
  });

  await session.setViewport({ name: 'tablet', width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
  await session.navigate(`${BASE_URL}/`);
  const tabletWorkflowState = await session.evaluate(`(() => {
    const section = document.querySelector('.home-v5 .landing-workflow');
    const rail = section?.querySelector('.landing-workflow-rail');
    const tabs = [...(rail?.querySelectorAll('[role="tab"]') || [])];
    const panel = section?.querySelector('[role="tabpanel"]');
    section?.scrollIntoView({ block: 'start' });
    const sectionRect = section?.getBoundingClientRect();
    return {
      tabCount: tabs.length,
      selectedCount: tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
      panelVisible: Boolean(panel && getComputedStyle(panel).display !== 'none'),
      panelOverflowX: Boolean(panel && panel.scrollWidth > panel.clientWidth + 1),
      sectionWithinViewport: Boolean(sectionRect && sectionRect.left >= -1 && sectionRect.right <= innerWidth + 1),
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`);
  results.push({
    step: 'landing workflow stays contained at tablet width',
    ok: tabletWorkflowState.tabCount === 3
      && tabletWorkflowState.selectedCount === 1
      && tabletWorkflowState.panelVisible
      && !tabletWorkflowState.panelOverflowX
      && tabletWorkflowState.sectionWithinViewport
      && !tabletWorkflowState.pageOverflowX,
    tabletWorkflowState,
  });

  await session.navigate(`${BASE_URL}/terms`);
  await waitFor(
    () => session.evaluate(`document.querySelectorAll('.terms-v5 .mkt4-legal-section').length === ${termsSections.length}`),
    'interactive Terms content',
    Math.min(TIMEOUT_MS, 15000),
  );
  const termsLinkClicked = await session.evaluate(clickExpression('.terms-v5 .mkt4-legal-nav a[href="#ai-features"]'));
  await delay(700);
  const termsState = await session.evaluate(`(() => {
    const section = document.querySelector('#ai-features');
    const contents = document.querySelector('.terms-v5 .mkt4-legal-nav');
    const sectionRect = section?.getBoundingClientRect();
    const contentsRect = contents?.getBoundingClientRect();
    return {
      hash: location.hash,
      count: document.querySelectorAll('.terms-v5 .mkt4-legal-section').length,
      sectionHeading: section?.querySelector('h2')?.textContent?.trim() || '',
      sectionTop: sectionRect ? Math.round(sectionRect.top) : null,
      contentsBottom: contentsRect ? Math.round(contentsRect.bottom) : null,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`);
  results.push({
    step: 'Terms contents rail reaches a complete current section',
    ok: termsLinkClicked.ok
      && termsState.hash === '#ai-features'
      && termsState.count === termsSections.length
      && termsState.sectionHeading === 'AI features and Bananas'
      && termsState.sectionTop >= termsState.contentsBottom + 8
      && !termsState.pageOverflowX,
    termsLinkClicked,
    termsState,
  });

  await session.setViewport(viewports[0]);
  await session.navigate(`${BASE_URL}/seo-smoke-missing`);
  const notFoundBefore = await session.evaluate(pageStateExpression('/seo-smoke-missing', 'desktop'));
  const returnHomeClicked = await session.evaluate(clickTextExpression('.not-found-page a[href="/"]', 'Return Home'));
  await delay(500);
  href = await session.evaluate('location.pathname');
  results.push({
    step: 'branded not-found page returns home',
    ok: notFoundBefore.notFoundVisible && !notFoundBefore.canonical && returnHomeClicked.ok && href === '/',
    notFoundBefore,
    returnHomeClicked,
    href,
  });

  await session.navigate(`${BASE_URL}/`);
  clicked = await session.evaluate(clickExpression('.desktop-nav a[href="/features"]'));
  await delay(600);
  href = await session.evaluate('location.pathname');
  results.push({ step: 'desktop nav Features click', ok: clicked.ok && href === '/features', href, clicked });

  const marketingNavRoutes = [
    ['/features', 'Features'],
    ['/features/', 'Features'],
    ['/pricing', 'Pricing'],
    ['/download', 'Download'],
    ['/story', 'Story'],
    ['/faq', null],
    ['/privacy', null],
    ['/terms', null],
  ];
  const marketingNavStates = [];
  for (const [route, expectedActive] of marketingNavRoutes) {
    await session.navigate(`${BASE_URL}${route}`);
    const navState = await session.evaluate(`(() => {
      const shell = document.querySelector('.marketing-nav-shell');
      const desktop = document.querySelector('.desktop-nav');
      const active = document.querySelector('.marketing-nav-links a[aria-current="page"]');
      if (!shell || !desktop) return { exists: false };
      const rect = shell.getBoundingClientRect();
      return {
        exists: true,
        pathname: location.pathname,
        active: active?.textContent?.trim() || null,
        desktopDisplay: getComputedStyle(desktop).display,
        shellWidth: Math.round(rect.width),
        viewportWidth: window.innerWidth,
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      };
    })()`);
    marketingNavStates.push({ route, expectedActive, ...navState });
  }
  results.push({
    step: 'modern navigation persists across marketing pages',
    ok: marketingNavStates.every((state) => state.exists
      && state.pathname === state.route
      && state.active === state.expectedActive
      && state.desktopDisplay === 'grid'
      && state.shellWidth <= Math.min(1470, state.viewportWidth)
      && !state.pageOverflowX),
    marketingNavStates,
  });

  await session.setViewport(viewports[1]);
  await session.navigate(`${BASE_URL}/`);
  demoState = await session.evaluate(demoStateExpression('mobile'));
  results.push({
    step: 'landing demo fits mobile without overflow',
    ok: demoState.exists && !demoState.pageOverflowX && !demoState.demoOverflowX && demoState.demoWithinViewport,
    demoState,
  });
  clicked = await session.evaluate(clickExpression('#mobile-menu-btn'));
  await delay(250);
  const navMenuState = await session.evaluate(`(() => {
    const menu = document.querySelector('#marketing-mobile-nav-links');
    const button = document.querySelector('#mobile-menu-btn');
    if (!menu || !button) return { exists: false };
    const rect = menu.getBoundingClientRect();
    const style = getComputedStyle(menu);
    const cta = menu.querySelector('.mobile-signup-link');
    const ctaRect = cta?.getBoundingClientRect();
    const ctaHit = ctaRect ? document.elementFromPoint(ctaRect.left + (ctaRect.width / 2), ctaRect.top + (ctaRect.height / 2)) : null;
    const links = [...menu.querySelectorAll('a')];
    return {
      exists: true,
      open: menu.classList.contains('is-open') && button.getAttribute('aria-expanded') === 'true',
      ariaHidden: menu.getAttribute('aria-hidden'),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      opacity: style.opacity,
      visibility: style.visibility,
      groups: [...menu.querySelectorAll('.mobile-nav-group > h2')].map((heading) => heading.textContent.trim()),
      labels: links.map((link) => link.textContent.trim()),
      active: menu.querySelector('a[aria-current="page"]')?.textContent?.trim() || null,
      minLinkHeight: Math.min(...links.map((link) => link.getBoundingClientRect().height)),
      actionZone: Boolean(menu.querySelector('.mobile-nav-action-zone')),
      ctaReachable: Boolean(cta && ctaHit && (cta === ctaHit || cta.contains(ctaHit))),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`);
  results.push({
    step: 'mobile navigation groups destinations and actions',
    ok: clicked.ok
      && navMenuState.open
      && navMenuState.ariaHidden === 'false'
      && navMenuState.opacity === '1'
      && navMenuState.visibility === 'visible'
      && navMenuState.left >= 8
      && navMenuState.right <= navMenuState.viewportWidth - 8
      && navMenuState.bottom <= navMenuState.viewportHeight - 8
      && navMenuState.width < navMenuState.viewportWidth - 16
      && navMenuState.groups.join('|') === 'Discover|Resources'
      && ['Home', 'Features', 'Pricing', 'Download', 'Story', 'FAQ', 'Privacy', 'Terms', 'Open the app']
        .every((label) => navMenuState.labels.includes(label))
      && navMenuState.active === 'Home'
      && navMenuState.minLinkHeight >= 44
      && navMenuState.actionZone
      && navMenuState.ctaReachable
      && !navMenuState.overflowX,
    navMenuState,
    clicked,
  });

  await session.evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  await delay(100);
  const escapedNavState = await session.evaluate(`(() => {
    const menu = document.querySelector('#marketing-mobile-nav-links');
    const button = document.querySelector('#mobile-menu-btn');
    return {
      open: Boolean(menu?.classList.contains('is-open')),
      expanded: button?.getAttribute('aria-expanded'),
      ariaHidden: menu?.getAttribute('aria-hidden'),
      focusedId: document.activeElement?.id || null,
    };
  })()`);
  results.push({
    step: 'mobile navigation closes with Escape and restores focus',
    ok: !escapedNavState.open
      && escapedNavState.expanded === 'false'
      && escapedNavState.ariaHidden === 'true'
      && escapedNavState.focusedId === 'mobile-menu-btn',
    escapedNavState,
  });

  await session.navigate(`${BASE_URL}/features`);
  clicked = await session.evaluate(clickExpression('#mobile-menu-btn'));
  await delay(250);
  const featureMobileNavState = await session.evaluate(`(() => {
    const menu = document.querySelector('#marketing-mobile-nav-links');
    const active = menu?.querySelector('a[aria-current="page"]');
    const rect = menu?.getBoundingClientRect();
    return {
      open: Boolean(menu?.classList.contains('is-open')),
      active: active?.textContent?.trim() || null,
      left: rect ? Math.round(rect.left) : 0,
      right: rect ? Math.round(rect.right) : 0,
      width: rect ? Math.round(rect.width) : 0,
      viewportWidth: window.innerWidth,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`);
  results.push({
    step: 'mobile navigation marks the active route without overflow',
    ok: clicked.ok
      && featureMobileNavState.open
      && featureMobileNavState.active === 'Features'
      && featureMobileNavState.left >= 8
      && featureMobileNavState.right <= featureMobileNavState.viewportWidth - 8
      && !featureMobileNavState.overflowX,
    featureMobileNavState,
    clicked,
  });
  clicked = await session.evaluate(clickExpression('#marketing-mobile-nav-links .mobile-signup-link'));
  await delay(700);
  href = await session.evaluate('location.pathname');
  results.push({ step: 'mobile Open app click reaches login', ok: clicked.ok && href === '/login', href, clicked });

  const compactNavStates = [];
  const compactNavViewports = [
    { name: 'compact-phone', width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
    { name: 'short-landscape', width: 844, height: 390, deviceScaleFactor: 1, mobile: true },
  ];
  for (const viewport of compactNavViewports) {
    await session.setViewport(viewport);
    await session.navigate(`${BASE_URL}/`);
    const compactClick = await session.evaluate(clickExpression('#mobile-menu-btn'));
    await delay(200);
    const state = await session.evaluate(`(() => {
      const menu = document.querySelector('#marketing-mobile-nav-links');
      const region = menu?.querySelector('.mobile-nav-scroll-region');
      const cta = menu?.querySelector('.mobile-signup-link');
      if (!menu || !region || !cta) return { exists: false };
      const rect = menu.getBoundingClientRect();
      const ctaRect = cta.getBoundingClientRect();
      const ctaHit = document.elementFromPoint(ctaRect.left + (ctaRect.width / 2), ctaRect.top + (ctaRect.height / 2));
      const links = [...menu.querySelectorAll('a')];
      return {
        exists: true,
        open: menu.classList.contains('is-open'),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        minLinkHeight: Math.min(...links.map((link) => link.getBoundingClientRect().height)),
        regionOverflowY: getComputedStyle(region).overflowY,
        regionClientHeight: region.clientHeight,
        regionScrollHeight: region.scrollHeight,
        ctaBottom: Math.round(ctaRect.bottom),
        ctaReachable: Boolean(ctaHit && (cta === ctaHit || cta.contains(ctaHit))),
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      };
    })()`);
    compactNavStates.push({ viewport: viewport.name, compactClick, ...state });
  }
  results.push({
    step: 'mobile navigation stays contained on short and narrow screens',
    ok: compactNavStates.every((state) => state.compactClick.ok
      && state.exists
      && state.open
      && state.left >= 8
      && state.right <= state.viewportWidth - 8
      && state.bottom <= state.viewportHeight - 8
      && state.ctaBottom <= state.viewportHeight - 8
      && state.minLinkHeight >= 44
      && state.regionOverflowY === 'auto'
      && state.ctaReachable
      && !state.pageOverflowX),
    compactNavStates,
  });

  await session.setViewport({ name: 'mobile-breakpoint', width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await session.navigate(`${BASE_URL}/`);
  const breakpointClick = await session.evaluate(clickExpression('#mobile-menu-btn'));
  await delay(150);
  const breakpointOpen = await session.evaluate(`document.querySelector('#mobile-menu-btn')?.getAttribute('aria-expanded')`);
  await session.setViewport({ name: 'desktop-breakpoint', width: 901, height: 700, deviceScaleFactor: 1, mobile: false });
  await delay(150);
  const breakpointClosedState = await session.evaluate(`(() => ({
    expanded: document.querySelector('#mobile-menu-btn')?.getAttribute('aria-expanded'),
    open: document.querySelector('#marketing-mobile-nav-links')?.classList.contains('is-open'),
    ariaHidden: document.querySelector('#marketing-mobile-nav-links')?.getAttribute('aria-hidden'),
    desktopDisplay: getComputedStyle(document.querySelector('.desktop-nav')).display,
  }))()`);
  results.push({
    step: 'mobile navigation clears its open state at the desktop breakpoint',
    ok: breakpointClick.ok
      && breakpointOpen === 'true'
      && breakpointClosedState.expanded === 'false'
      && !breakpointClosedState.open
      && breakpointClosedState.ariaHidden === 'true'
      && breakpointClosedState.desktopDisplay === 'grid',
    breakpointClick,
    breakpointOpen,
    breakpointClosedState,
  });

  return results;
}

function cleanup() {
  for (const child of children.reverse()) {
    try {
      if (!child?.pid || child.exitCode !== null) continue;
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // best effort
    }
  }
  if (chromeProfileDir) {
    try {
      rmSync(chromeProfileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Chrome can hold the profile briefly on Windows; leave temp cleanup to the OS.
    }
  }
}

async function main() {
  debug('main start');
  startPreviewServer();
  debug('waiting for preview');
  await waitForHttp(BASE_URL, 'Vite preview server');
  debug('preview is ready');
  startChrome();
  debug('waiting for Chrome DevTools endpoint');
  await waitForHttp(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`, 'Chrome DevTools endpoint');
  debug('Chrome DevTools endpoint is ready');

  const session = new CdpSession(await newPageWebSocketUrl());
  debug('opening CDP websocket');
  await session.open();
  debug('setting up CDP session');
  await session.setup();

  const startupContinuity = [];
  for (const viewport of viewports) {
    startupContinuity.push(await traceLandingStartup(session, viewport));
  }

  const pages = [];
  if (!STARTUP_ONLY) {
    for (const viewport of viewports) {
      await session.setViewport(viewport);
      for (const route of routes) {
        pages.push(await inspectRoute(session, viewport, route));
      }
    }
  }
  const interactions = [
    ...startupContinuity,
    ...(STARTUP_ONLY ? [] : await testInteractions(session)),
  ];
  session.close();

  const failures = [
    ...pages.filter((page) => !page.ok).map((page) => `${page.viewport} ${page.route}: ${page.failures.join(', ')}`),
    ...interactions.filter((item) => !item.ok).map((item) => `${item.step}: ${JSON.stringify(item)}`),
  ];

  const summary = {
    ok: failures.length === 0,
    baseUrl: BASE_URL,
    browser: 'Chrome DevTools Protocol',
    pages: pages.map((page) => ({
      viewport: page.viewport,
      route: page.route,
      url: page.url,
      overflowX: page.overflowX,
      controlsCount: page.controlsCount,
      googleButtonMounted: page.googleButtonMounted,
      ok: page.ok,
      failures: page.failures,
    })),
    interactions,
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) process.exitCode = 1;
}

try {
  await main();
} finally {
  cleanup();
}
