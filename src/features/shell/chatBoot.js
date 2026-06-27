import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BootSequence } from './BootSequence.jsx';

let bootSequenceRoot = null;

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const withTimeout = (work, ms = 900) => Promise.race([
  Promise.resolve().then(work),
  wait(ms),
]).catch(() => undefined);

const warmStaticAsset = (url) => withTimeout(() => fetch(url, {
  cache: 'force-cache',
  credentials: 'same-origin',
  mode: 'same-origin',
}).catch(() => undefined), 850);

const warmImage = (src) => withTimeout(() => new Promise((resolve) => {
  if (!src) {
    resolve();
    return;
  }
  const image = new Image();
  image.decoding = 'async';
  image.onload = resolve;
  image.onerror = resolve;
  image.src = src;
}), 850);

function warmCriticalStyles() {
  return withTimeout(() => window.__minimalistCssReady || Promise.resolve(), 1400);
}

function warmCriticalFonts() {
  return withTimeout(async () => {
    if (!document.fonts?.load) return;
    await Promise.allSettled([
      document.fonts.load('700 14px Inter'),
      document.fonts.load('700 14px "Space Grotesk"'),
    ]);
  }, 1000);
}

function warmShellAssets() {
  const icon = document.querySelector('link[rel~="icon"]')?.href || '/icon.svg';
  const manifest = document.querySelector('link[rel="manifest"]')?.href || '/manifest.json';
  return Promise.allSettled([
    warmStaticAsset('/config.js?v=6'),
    warmStaticAsset(manifest),
    warmStaticAsset('/icon.svg'),
    warmImage(icon),
  ]);
}

window.enterChat = function enterChat() {
  try {
    const desktopNavActions = document.getElementById('nav-actions');

    const launchChatUI = () => {
      window.showScreen('chat-wrapper');

      const handlePendingJoinRoute = () => {
        const pendingJoin = sessionStorage.getItem('pendingJoinUrl');
        const currentPath = window.location.pathname;
        const pathToCheck = pendingJoin || currentPath;

        if (!/\/join\//i.test(pathToCheck)) return;

        const urlCode = pathToCheck.split(/\/join\//i).pop();
        const clearJoinRoute = () => {
          sessionStorage.removeItem('pendingJoinUrl');
          if (currentPath.includes('/join/')) window.history.pushState({}, '', '/chat');
        };
        const openJoinFallback = () => {
          if (!urlCode || !document.getElementById('room-action-modal')) return;
          if (window.openJoinRoomModal) {
            window.openJoinRoomModal(urlCode);
            return;
          }
          document.getElementById('room-action-title').textContent = 'Join Room';
          document.getElementById('room-action-label').textContent = 'INVITE LINK OR CODE';
          document.getElementById('room-action-input').value = urlCode;
          document.getElementById('room-action-input').placeholder = 'Paste full link or code...';
          document.getElementById('room-action-submit').textContent = 'Join';
          document.getElementById('room-action-modal').classList.remove('hidden');
        };

        if (urlCode && window.joinRoomFromInvite) {
          window.joinRoomFromInvite(urlCode, { openModalOnFailure: false })
            .then((joined) => {
              if (!joined) openJoinFallback();
            })
            .finally(clearJoinRoute);
        } else {
          openJoinFallback();
          clearJoinRoute();
        }
      };

      if (window.chatInitialized) {
        handlePendingJoinRoute();
        return;
      }

      if (window.initializeRooms) window.initializeRooms();
      window.listenForPmInbox();
      window.listenForNotifications();
      if (window.initializePresence) window.initializePresence();
      if (window.initMessageTools) window.initMessageTools();
      window.chatInitialized = true;
      if (window.maybeShowWelcomeTour) window.maybeShowWelcomeTour();

      handlePendingJoinRoute();

      const profileRef = new URLSearchParams(window.location.search).get('profile');
      if (profileRef && window.openProfileByRef) {
        setTimeout(() => window.openProfileByRef(profileRef), 900);
        window.history.replaceState({}, '', '/chat');
      }
    };

    const performanceSettings = window.getPerformanceSettings?.();
    if (performanceSettings?.effectiveLowPerformanceMode) {
      sessionStorage.setItem('blipLoaded', 'true');
      launchChatUI();
      return;
    }

    if (sessionStorage.getItem('blipLoaded') === 'true') {
      launchChatUI();
      return;
    }

    window.showScreen('loading-screen');
    if (desktopNavActions) desktopNavActions.replaceChildren();

    const bootLines = [
      { scope: 'core', action: 'hydrate', target: 'react-root', note: 'claim app shell', duration: 160 },
      { scope: 'theme', action: 'resolve', target: 'css-graph', note: 'critical styles', run: warmCriticalStyles, duration: 220 },
      { scope: 'font', action: 'warm', target: 'brand-type', note: 'swap-safe text', run: warmCriticalFonts, duration: 190 },
      { scope: 'asset', action: 'cache', target: 'icons+manifest', note: 'logo pack ready', run: warmShellAssets, duration: 240 },
      { scope: 'security', action: 'mount', target: 'protocols', note: 'attach guards', duration: 140 },
      { scope: 'auth', action: 'verify', target: 'identity', note: 'session accepted', duration: 180 },
      { scope: 'module', action: 'bind', target: 'rooms.js', note: 'map room rail', duration: 150 },
      { scope: 'module', action: 'bind', target: 'chat.js', note: 'composer + messages', duration: 150 },
      { scope: 'database', action: 'prime', target: 'firebase', note: 'listeners queued', duration: 180 },
      { scope: 'notify', action: 'arm', target: 'pm+mentions', note: 'sound + inbox bridge', duration: 130 },
      { scope: 'surface', action: 'paint', target: 'minimalist.ui', note: 'handoff frame', duration: 360 },
    ];

    const seqContainer = document.getElementById('boot-sequence');
    if (!seqContainer) {
      setTimeout(() => {
        sessionStorage.setItem('blipLoaded', 'true');
        launchChatUI();
      }, 2000);
      return;
    }

    if (!bootSequenceRoot) {
      seqContainer.replaceChildren();
      bootSequenceRoot = createRoot(seqContainer);
    }
    let visibleCount = 0;
    let completedCount = 0;

    const renderBootSequence = () => {
      bootSequenceRoot.render(createElement(BootSequence, {
        lines: bootLines,
        visibleCount,
        completedCount,
      }));
    };

    renderBootSequence();

    const showNextLine = async () => {
      if (visibleCount > 0) {
        completedCount = visibleCount;
        renderBootSequence();
      }

      if (visibleCount < bootLines.length) {
        const line = bootLines[visibleCount];
        const isLast = visibleCount === bootLines.length - 1;
        visibleCount += 1;
        completedCount = visibleCount - 1;
        renderBootSequence();
        const delay = isLast ? 520 : Math.floor(Math.random() * 120) + (line.duration || 120);
        await Promise.all([line.run ? line.run() : Promise.resolve(), wait(delay)]);
        showNextLine();
        return;
      }

      const loader = document.getElementById('loading-screen');
      if (!loader) return;

      loader.style.opacity = '0';
      setTimeout(() => {
        sessionStorage.setItem('blipLoaded', 'true');
        launchChatUI();
        loader.classList.add('hidden');
        loader.style.opacity = '1';
      }, 500);
    };

    setTimeout(showNextLine, 300);
  } catch (error) {
    window.showToast(`Error launching chat interface: ${error.message}`);
  }
};
