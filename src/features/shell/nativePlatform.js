if (window.Capacitor && window.Capacitor.isNativePlatform()) {
  document.querySelectorAll('.mobile-link[href="/"], .mobile-link[href="/story"]').forEach((link) => {
    link.style.display = 'none';
  });

  const logoLink = document.getElementById('nav-logo');
  if (logoLink) logoLink.href = '/chat';

  document.querySelectorAll('a[href="/chat"]').forEach((link) => {
    link.href = '/chat';
  });
}
