import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MarketingNav } from './MarketingNav.jsx';

window.addEventListener('error', (event) => {
  if (event.filename && event.filename.includes('extension')) return;
  if (event.message && event.message.includes('s is not defined')) return;
  if (window.showToast) window.showToast(`Script Crash: ${event.message}`);
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || event.reason || '';
  if (typeof msg === 'string' && msg.includes('MetaMask')) return;
  if (window.showToast) window.showToast(`Database/Network Crash: ${msg}`);
});

window.showToast = function showToast(message, isError = true) {
  const toast = document.getElementById('brutalist-toast');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  if (toast && toastMsg) {
    toastMsg.textContent = message;
    if (toastIcon) {
      toastIcon.textContent = '';
      toastIcon.className = `ph-bold ${isError ? 'ph-warning' : 'ph-check-circle'}`;
    }
    toast.hidden = false;
    toast.setAttribute('aria-hidden', 'false');
    toast.setAttribute('role', isError ? 'alert' : 'status');
    toast.querySelector('#toast-close')?.setAttribute('tabindex', '0');
    toast.classList.toggle('toast-error', Boolean(isError));
    toast.classList.toggle('toast-success', !isError);
    toast.classList.remove('toast-hidden');
    window.clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
      toast.classList.add('toast-hidden');
      toast.hidden = true;
      toast.setAttribute('aria-hidden', 'true');
      toast.querySelector('#toast-close')?.setAttribute('tabindex', '-1');
      toastMsg.textContent = '';
      if (toastIcon) toastIcon.textContent = '';
    }, 4000);
    return;
  }

  alert(message);
};

window.showScreen = function showScreen(screenId) {
  document.querySelectorAll('.app-screen').forEach((screen) => {
    screen.classList.add('hidden');
  });

  const target = document.getElementById(screenId);
  if (target) target.classList.remove('hidden');

  const footer = document.querySelector('footer');
  if (footer) footer.style.display = screenId === 'chat-wrapper' ? 'none' : 'block';
};

(function buildGuestNav() {
  if (!document.body.classList.contains('marketing')) return;

  const navEl = document.querySelector('nav');
  if (!navEl) return;

  const path = (location.pathname.replace(/\.html$/, '').replace(/\/$/, '')) || '/';
  const loggedIn = !!window.currentUser;
  const navRoot = createRoot(navEl);
  navRoot.render(createElement(MarketingNav, { path, loggedIn }));
})();

document.addEventListener('click', (event) => {
  if (event.target.id === 'toast-close') {
    const toast = document.getElementById('brutalist-toast');
    toast?.classList.add('toast-hidden');
    if (toast) {
      toast.hidden = true;
      toast.setAttribute('aria-hidden', 'true');
      toast.querySelector('#toast-close')?.setAttribute('tabindex', '-1');
      const message = toast.querySelector('#toast-message');
      const icon = toast.querySelector('#toast-icon');
      if (message) message.textContent = '';
      if (icon) icon.textContent = '';
    }
  }
  if (event.target.id === 'close-mobile-rooms-btn') document.getElementById('desktop-room-sidebar')?.classList.remove('open');
  if (event.target.closest?.('#close-updates-btn')) {
    if (typeof window.closeUpdatesPanel === 'function') window.closeUpdatesPanel();
    else document.getElementById('updates-panel')?.classList.remove('open');
  }
});
