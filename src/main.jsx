import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@phosphor-icons/web/bold';
import App from './App.jsx';
import './react-shell.css';

const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

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

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
