const userAgent = navigator.userAgent || '';
const isAndroidDevice = /Android/i.test(userAgent);
const isStandaloneDisplay = window.matchMedia?.('(display-mode: standalone)')?.matches === true
  || window.matchMedia?.('(display-mode: fullscreen)')?.matches === true
  || window.navigator.standalone === true;

if (isAndroidDevice) {
  document.documentElement.classList.add('android-device');
  if (isStandaloneDisplay) document.documentElement.classList.add('android-standalone');
}

if (window.Capacitor && window.Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-platform');
  if (isAndroidDevice) {
    document.documentElement.classList.add('android-standalone');
  }

  document.querySelectorAll('.mobile-link[href="/"], .mobile-link[href="/story"]').forEach((link) => {
    link.style.display = 'none';
  });

  const logoLink = document.getElementById('nav-logo');
  if (logoLink) logoLink.href = '/chat';

  document.querySelectorAll('a[href="/chat"]').forEach((link) => {
    link.href = '/chat';
  });
}
