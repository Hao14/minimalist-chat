import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = Number(process.env.UI_SMOKE_PORT || 4173);
const BASE_URL = String(process.env.UI_SMOKE_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/$/, '');
const USE_EXISTING_SERVER = Boolean(process.env.UI_SMOKE_BASE_URL);
const REQUIRE_GOOGLE_BUTTON = !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE_URL);
const CHROME_DEBUG_PORT = Number(process.env.UI_SMOKE_CHROME_PORT || 9339);
const TIMEOUT_MS = Number(process.env.UI_SMOKE_TIMEOUT_MS || 30000);

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
      }, 10000);
      this.pending.set(id, { resolve, reject, timeoutId });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setup() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
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
    await this.send('Page.navigate', { url });
    await delay(900);
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
  if (route === '/faq' && state.faqCount !== 6) failures.push(`expected 6 FAQ rows, found ${state.faqCount}`);
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
    step: 'FAQ exposes six interactive visible answers',
    ok: faqClicked.ok && faqState.count === 6 && faqState.opened && faqState.answer.length > 20,
    faqClicked,
    faqState,
  });

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
    ['/pricing', null],
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
    return {
      exists: true,
      open: menu.classList.contains('is-open') && button.getAttribute('aria-expanded') === 'true',
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      opacity: style.opacity,
      visibility: style.visibility,
      labels: [...menu.querySelectorAll('a')].map((link) => link.textContent.trim()),
    };
  })()`);
  results.push({
    step: 'mobile navigation opens as a compact popover',
    ok: clicked.ok
      && navMenuState.open
      && navMenuState.opacity === '1'
      && navMenuState.visibility === 'visible'
      && navMenuState.width <= 340
      && navMenuState.width < navMenuState.viewportWidth - 16
      && navMenuState.height < 300
      && navMenuState.labels.includes('Open the app'),
    navMenuState,
    clicked,
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
      width: rect ? Math.round(rect.width) : 0,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`);
  results.push({
    step: 'mobile navigation stays modern on Features',
    ok: clicked.ok
      && featureMobileNavState.open
      && featureMobileNavState.active === 'Features'
      && featureMobileNavState.width <= 340
      && !featureMobileNavState.overflowX,
    featureMobileNavState,
    clicked,
  });
  clicked = await session.evaluate(clickExpression('#marketing-mobile-nav-links .mobile-signup-link'));
  await delay(700);
  href = await session.evaluate('location.pathname');
  results.push({ step: 'mobile Open app click reaches login', ok: clicked.ok && href === '/login', href, clicked });

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

  const pages = [];
  for (const viewport of viewports) {
    await session.setViewport(viewport);
    for (const route of routes) {
      pages.push(await inspectRoute(session, viewport, route));
    }
  }
  const interactions = await testInteractions(session);
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
