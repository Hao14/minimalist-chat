import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './react-shell.css';

const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const iconStylesHref = '/phosphor-bold-subset.css?v=1';
let iconStylesPromise;
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

const hideStaticHomeShell = () => {
  if (window.location.pathname && window.location.pathname !== '/') {
    document.getElementById('static-home-shell')?.remove();
    return;
  }
  Promise.race([
    window.__minimalistDeferredCssReady || Promise.resolve(),
    new Promise((resolve) => window.setTimeout(resolve, 900)),
  ]).then(() => {
    const staticShell = document.getElementById('static-home-shell');
    if (!staticShell) return;
    staticShell.classList.add('static-home-hide');
    window.setTimeout(() => staticShell.remove(), 220);
  });
};

window.addEventListener('minimalist:marketing-mounted', hideStaticHomeShell, { once: true });
window.requestAnimationFrame(hideStaticHomeShell);

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

Promise.race([
  window.__minimalistCssReady || fallbackCssReady,
  new Promise((resolve) => window.setTimeout(resolve, 2400)),
]).then(hideBootShell);
