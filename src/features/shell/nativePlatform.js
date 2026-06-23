if (window.Capacitor && window.Capacitor.isNativePlatform()) {
  document.getElementById('google-login-btn')?.style.setProperty('display', 'none');
  document.getElementById('google-signup-btn')?.style.setProperty('display', 'none');

  document.querySelectorAll('.mobile-link[href="/"], .mobile-link[href="/story"]').forEach((link) => {
    link.style.display = 'none';
  });

  const logoLink = document.getElementById('nav-logo');
  if (logoLink) logoLink.href = '/chat';

  document.querySelectorAll('a[href="/chat"]').forEach((link) => {
    link.href = '/chat';
  });
}
