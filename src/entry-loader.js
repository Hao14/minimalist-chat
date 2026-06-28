const path = window.location.pathname || '/';
const isHomeRoute = path === '/' || path === '';
let appLoading = false;

const loadApp = () => {
  if (appLoading) return;
  appLoading = true;
  import('./main.jsx');
};

if (isHomeRoute) {
  const loadSoon = () => {
    loadApp();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSoon, { once: true });
  } else {
    loadSoon();
  }
} else {
  loadApp();
}
