import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './react-shell.css';

const VITE_PRELOAD_RECOVERY_KEY = 'minimalist:vite-preload-recovery';
const VITE_PRELOAD_RECOVERY_WINDOW_MS = 60_000;

function recoverFromStaleDeploymentChunk() {
  const now = Date.now();
  let lastRecovery = 0;
  try {
    lastRecovery = Number(window.sessionStorage?.getItem(VITE_PRELOAD_RECOVERY_KEY) || 0);
    if (now - lastRecovery < VITE_PRELOAD_RECOVERY_WINDOW_MS) return false;
    window.sessionStorage?.setItem(VITE_PRELOAD_RECOVERY_KEY, String(now));
  } catch {
    // Avoid a reload loop when storage cannot record the recovery attempt.
    return false;
  }
  window.location.reload();
  return true;
}

window.addEventListener('vite:preloadError', (event) => {
  if (recoverFromStaleDeploymentChunk()) event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  const message = String(event.reason?.message || event.reason || '');
  if (!/failed to fetch dynamically imported module|importing a module script failed/i.test(message)) return;
  if (recoverFromStaleDeploymentChunk()) event.preventDefault();
});

window.setTimeout(() => {
  try {
    window.sessionStorage?.removeItem(VITE_PRELOAD_RECOVERY_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}, VITE_PRELOAD_RECOVERY_WINDOW_MS);

const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const launchPath = window.location.pathname || '/';
const isAppLaunchRoute = /^\/(?:chat|join|login)(?:\/|$)/.test(launchPath);
let hasAuthPresenceHint = false;
try {
  hasAuthPresenceHint = window.localStorage?.getItem('minimalist.auth.present.v1') === '1';
} catch {
  hasAuthPresenceHint = false;
}
const isChatLaunchRoute = hasAuthPresenceHint && /^\/(?:chat|join)(?:\/|$)/.test(launchPath);
const iconStylesHref = '/phosphor-bold-subset.css?v=2';
const launchStartedAt = Date.now();
let iconStylesPromise;

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const withTimeout = (promise, timeoutMs) => Promise.race([
  Promise.resolve(promise),
  wait(timeoutMs),
]).catch(() => undefined);

const afterPaintFrames = () => new Promise((resolve) => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(resolve);
  });
});

const loadIconStyles = () => {
  if (iconStylesPromise) return iconStylesPromise;

  iconStylesPromise = new Promise((resolve) => {
    const existingStylesheet = document.querySelector('link[data-phosphor-bold-subset]');
    if (existingStylesheet) {
      if (existingStylesheet.sheet) {
        resolve();
        return;
      }
      existingStylesheet.addEventListener('load', resolve, { once: true });
      existingStylesheet.addEventListener('error', resolve, { once: true });
      return;
    }

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = iconStylesHref;
    stylesheet.dataset.phosphorBoldSubset = 'true';
    stylesheet.addEventListener('load', resolve, { once: true });
    stylesheet.addEventListener('error', resolve, { once: true });
    document.head.appendChild(stylesheet);
  });

  return iconStylesPromise;
};
const shouldLoadIconsImmediately = window.location.pathname.startsWith('/chat') || window.location.pathname.startsWith('/login');

if (import.meta.env.DEV && isLocalDevelopmentHost && 'serviceWorker' in navigator) {
  const devServiceWorkerRefreshKey = 'minimalist-dev-service-worker-cleared';

  navigator.serviceWorker.getRegistrations()
    .then(async (registrations) => {
      if (!registrations.length) return;

      await Promise.all(registrations.map((registration) => registration.unregister()));

      if (navigator.serviceWorker.controller && sessionStorage.getItem(devServiceWorkerRefreshKey) !== '1') {
        sessionStorage.setItem(devServiceWorkerRefreshKey, '1');
        window.location.reload();
      }
    })
    .catch(() => {
      // Dev-only cleanup is best-effort; never block the app from rendering.
    });
}

const installState = {
  canInstall: false,
  installed: window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true,
  promptEvent: null,
};

function emitInstallState() {
  window.dispatchEvent(new CustomEvent('minimalist:pwa-install-state', {
    detail: {
      canInstall: installState.canInstall,
      installed: installState.installed,
    },
  }));
}

window.getMinimalistInstallState = () => ({
  canInstall: installState.canInstall,
  installed: installState.installed,
});

window.promptMinimalistInstall = async () => {
  if (!installState.promptEvent) return { outcome: 'unavailable' };
  const promptEvent = installState.promptEvent;
  installState.promptEvent = null;
  installState.canInstall = false;
  emitInstallState();
  await promptEvent.prompt();
  return promptEvent.userChoice || { outcome: 'dismissed' };
};

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installState.promptEvent = event;
  installState.canInstall = true;
  emitInstallState();
});

window.addEventListener('appinstalled', () => {
  installState.installed = true;
  installState.canInstall = false;
  installState.promptEvent = null;
  emitInstallState();
});

if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration is best effort; the app remains usable without offline mode.
    });
  }, { once: true });
}

if (shouldLoadIconsImmediately && 'requestIdleCallback' in window) {
  window.requestIdleCallback(loadIconStyles, { timeout: 1200 });
} else if (shouldLoadIconsImmediately) {
  window.setTimeout(loadIconStyles, 900);
} else if ('requestIdleCallback' in window) {
  window.setTimeout(() => window.requestIdleCallback(loadIconStyles, { timeout: 1600 }), 6500);
} else {
  window.setTimeout(loadIconStyles, 6500);
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);

let staticHomeHideStarted = false;
const hideStaticHomeShell = () => {
  if (window.location.pathname && window.location.pathname !== '/') {
    document.getElementById('static-home-shell')?.remove();
    return;
  }
  if (staticHomeHideStarted) return;
  const staticShell = document.getElementById('static-home-shell');
  if (!staticShell) return;
  if (!document.querySelector('#root .landing-v3')) return;

  staticHomeHideStarted = true;
  Promise.race([
    window.__minimalistCssReady || Promise.resolve(),
    new Promise((resolve) => window.setTimeout(resolve, 900)),
  ]).then(afterPaintFrames).then(() => {
    // Keep the first-paint shell fully opaque until the styled React landing
    // page has painted, then swap once. A crossfade exposes both page trees and
    // reads as a second load even though React only mounted once.
    staticShell.remove();
  });
};

window.addEventListener('minimalist:marketing-mounted', hideStaticHomeShell, { once: true });
window.setTimeout(hideStaticHomeShell, 2200);

const hideBootShell = () => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const bootShell = document.getElementById('app-boot-shell');
      if (!bootShell) return;
      bootShell.classList.add('instant-shell-hide');
      window.setTimeout(() => bootShell.remove(), 240);
    });
  });
};

const fallbackCssReady = new Promise((resolve) => {
  if (document.readyState === 'complete') {
    resolve();
    return;
  }

  window.addEventListener('load', resolve, { once: true });
});

function documentReadyForLaunch() {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
}

async function waitForLaunchReadiness() {
  const minVisibleMs = isChatLaunchRoute ? 180 : isAppLaunchRoute ? 180 : 0;
  const maxVisibleMs = isAppLaunchRoute ? 4600 : 1900;
  const elapsed = Date.now() - launchStartedAt;
  const minDisplay = wait(Math.max(0, minVisibleMs - elapsed));
  const readiness = Promise.allSettled([
    window.__minimalistCssReady || fallbackCssReady,
    loadIconStyles(),
    documentReadyForLaunch(),
    minDisplay,
  ]).then(afterPaintFrames);

  await withTimeout(readiness, maxVisibleMs);
}

waitForLaunchReadiness().then(hideBootShell);
