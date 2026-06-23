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
    if (toastIcon) toastIcon.textContent = isError ? '!' : '✓';
    toast.classList.toggle('toast-error', Boolean(isError));
    toast.classList.toggle('toast-success', !isError);
    toast.classList.remove('toast-hidden');
    window.clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
      toast.classList.add('toast-hidden');
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
  const links = [
    ['/', 'Home'],
    ['/features', 'Features'],
    ['/download', 'Download'],
    ['/story', 'Story'],
  ];
  const active = (href) => (href === '/' ? (path === '/' || path === '/index') : path === href) ? 'active' : '';

  navEl.innerHTML = `
    <a href="/" id="nav-logo">
      <div class="mascot-blip"><div class="blip-eye left"></div><div class="blip-eye right"></div></div>
      <span class="logo-text">MINIMALIST</span>
    </a>
    <div class="desktop-nav">
      ${links.map(([href, label]) => `<a href="${href}" class="${active(href)}">${label}</a>`).join('')}
      <a href="/chat" class="auth-only hidden">Chat</a>
      <a href="/login" class="guest-only">Login</a>
      <a href="/login" class="nav-cta guest-only">Sign Up</a>
    </div>
    <button id="mobile-menu-btn" class="mobile-only nav-btn">MENU</button>
    <div id="mobile-nav-links" class="mobile-only hidden">
      ${links.map(([href, label]) => `<a href="${href}" class="mobile-link ${active(href)}">${label.toUpperCase()}</a>`).join('')}
      <a href="/chat" class="mobile-link auth-only hidden">CHAT</a>
      <a href="/login" class="mobile-link guest-only">LOGIN</a>
      <a href="/login" class="mobile-link guest-only">SIGN UP</a>
    </div>`;

  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    document.getElementById('mobile-nav-links')?.classList.toggle('hidden');
  });

  const loggedIn = !!window.currentUser;
  navEl.querySelectorAll('.auth-only').forEach((el) => el.classList.toggle('hidden', !loggedIn));
  navEl.querySelectorAll('.guest-only').forEach((el) => el.classList.toggle('hidden', loggedIn));
})();

document.addEventListener('click', (event) => {
  if (event.target.id === 'toast-close') document.getElementById('brutalist-toast')?.classList.add('toast-hidden');
  if (event.target.id === 'close-mobile-rooms-btn') document.getElementById('desktop-room-sidebar')?.classList.remove('open');
  if (event.target.id === 'close-updates-btn') document.getElementById('updates-panel')?.classList.remove('open');
});
