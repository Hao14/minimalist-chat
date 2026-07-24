import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BootSequence } from './BootSequence.jsx';
import {
  CHAT_BOOT_READY_TIMEOUT_MS,
  FIRST_CHAT_BOOT_MIN_MS,
  WARM_CHAT_BOOT_MIN_MS,
  isChatBootReadyStatus,
  waitForChatBootReadiness,
} from './chatBootReadiness.js';

let bootSequenceRoot = null;
let notificationRuntimeScheduled = false;
let notificationRuntimeRetryCount = 0;
const BOOT_TASK_TIMEOUT_MS = 900;
const BOOT_FADE_MS = 220;

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const withTimeout = (work, ms = 900) => Promise.race([
  Promise.resolve().then(work),
  wait(ms),
]).catch(() => undefined);

const nextFrame = () => new Promise((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const warmStaticAsset = (url, timeoutMs = 850) => withTimeout(() => fetch(url, {
  cache: 'force-cache',
  credentials: 'same-origin',
  mode: 'same-origin',
}).catch(() => undefined), timeoutMs);

const warmImage = (src, timeoutMs = 850) => withTimeout(() => new Promise((resolve) => {
  if (!src) {
    resolve();
    return;
  }
  const image = new Image();
  image.decoding = 'async';
  image.onload = resolve;
  image.onerror = resolve;
  image.src = src;
}), timeoutMs);

function warmCriticalStyles(timeoutMs = 1400) {
  return withTimeout(() => window.__minimalistCssReady || Promise.resolve(), timeoutMs);
}

function warmCriticalFonts(timeoutMs = 1000) {
  return withTimeout(async () => {
    if (!document.fonts?.load) return;
    await Promise.allSettled([
      document.fonts.load('700 14px Inter'),
      document.fonts.load('700 14px "Space Grotesk"'),
    ]);
  }, timeoutMs);
}

function warmShellAssets(timeoutMs = 850) {
  const icon = document.querySelector('link[rel~="icon"]')?.href || '/icon.svg';
  const manifest = document.querySelector('link[rel="manifest"]')?.href || '/manifest.json';
  const config = document.querySelector('script[data-minimalist-config]')?.getAttribute('src') || '/config.js?v=localai7';
  return Promise.allSettled([
    warmStaticAsset(config, timeoutMs),
    warmStaticAsset(manifest, timeoutMs),
    warmStaticAsset('/icon.svg', timeoutMs),
    warmStaticAsset('/phosphor-bold-subset.css?v=4', timeoutMs),
    warmImage(icon, timeoutMs),
  ]);
}

function scheduleNotificationRuntimeAfterHandoff() {
  if (notificationRuntimeScheduled) return;
  notificationRuntimeScheduled = true;

  const start = () => {
    Promise.resolve()
      .then(() => window.ensureNotificationRuntime?.())
      .then(() => Promise.allSettled([
        Promise.resolve().then(() => window.listenForPmInbox?.()),
        Promise.resolve().then(() => window.listenForNotifications?.()),
      ]))
      .catch((error) => {
        notificationRuntimeScheduled = false;
        console.warn('[boot] Notification runtime deferred startup failed.', error);
        if (notificationRuntimeRetryCount >= 1) return;
        notificationRuntimeRetryCount += 1;
        window.setTimeout(scheduleNotificationRuntimeAfterHandoff, 2000);
      });
  };

  const queueIdleStart = () => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(start, { timeout: 1200 });
    } else {
      window.setTimeout(start, 80);
    }
  };

  window.requestAnimationFrame(() => window.requestAnimationFrame(queueIdleStart));
}

window.addEventListener(
  'minimalist:chat-visible',
  scheduleNotificationRuntimeAfterHandoff,
  { once: true },
);

window.enterChat = function enterChat() {
  try {
    const desktopNavActions = document.getElementById('nav-actions');

    const stageChatBehindLoader = () => {
      const chatWrapper = document.getElementById('chat-wrapper');
      if (!chatWrapper) return;
      chatWrapper.classList.remove('hidden');
      chatWrapper.classList.add('chat-boot-staging');
      chatWrapper.setAttribute('inert', '');
      chatWrapper.setAttribute('aria-hidden', 'true');
    };

    const releaseStagedChat = () => {
      const chatWrapper = document.getElementById('chat-wrapper');
      if (!chatWrapper) return;
      chatWrapper.classList.remove('chat-boot-staging');
      chatWrapper.removeAttribute('inert');
      chatWrapper.removeAttribute('aria-hidden');
    };

    const launchChatUI = (runtimeStatus) => {
      window.showScreen('chat-wrapper');
      releaseStagedChat();
      window.dispatchEvent(new Event('minimalist:chat-visible'));
      if (isChatBootReadyStatus(runtimeStatus)) {
        window.dispatchEvent(new Event('minimalist:chat-interactive'));
      }

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

      if (window.maybeShowWelcomeTour) window.maybeShowWelcomeTour();

      handlePendingJoinRoute();

      const profileRef = new URLSearchParams(window.location.search).get('profile');
      if (profileRef && window.openProfileByRef) {
        setTimeout(() => window.openProfileByRef(profileRef), 900);
        window.history.replaceState({}, '', '/chat');
      }
    };

    const initializeChatRuntime = async () => {
      if (window.chatInitialized) return true;

      const chatCoreReadyPromise = window.initializeRooms
        ? Promise.resolve().then(() => window.initializeRooms())
        : Promise.resolve(false);
      const presenceReady = Promise.resolve()
        .then(() => window.initializePresence?.())
        .catch(() => undefined);
      const [chatCoreReady] = await Promise.all([
        chatCoreReadyPromise,
        presenceReady,
      ]);
      window.chatInitialized = chatCoreReady !== false;
      return window.chatInitialized;
    };

    const prepareChatRuntime = (minimumMs) => waitForChatBootReadiness({
      readiness: initializeChatRuntime(),
      minimumMs,
      maximumMs: CHAT_BOOT_READY_TIMEOUT_MS,
    }).then((status) => {
      if (status !== 'ready') {
        console.warn(`[boot] Chat runtime readiness ${status}; continuing with guarded handoff.`);
      }
      return status;
    });

    const performanceSettings = window.getPerformanceSettings?.();
    const reducedMotion = performanceSettings?.reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    const completeBoot = (runtimeStatus) => {
      if (isChatBootReadyStatus(runtimeStatus)) sessionStorage.setItem('blipLoaded', 'true');
      else sessionStorage.removeItem('blipLoaded');
      launchChatUI(runtimeStatus);
    };
    const hasBootedThisSession = sessionStorage.getItem('blipLoaded') === 'true';
    const launchAfterWarmStart = (minVisibleMs = WARM_CHAT_BOOT_MIN_MS) => {
      window.showScreen('loading-screen');
      stageChatBehindLoader();
      if (desktopNavActions) desktopNavActions.replaceChildren();

      const runtimeReady = prepareChatRuntime(minVisibleMs);
      Promise.allSettled([
        runtimeReady,
        warmCriticalStyles(BOOT_TASK_TIMEOUT_MS),
        warmCriticalFonts(BOOT_TASK_TIMEOUT_MS),
        warmShellAssets(BOOT_TASK_TIMEOUT_MS),
      ])
        .then(async () => {
          const runtimeStatus = await runtimeReady;
          await nextFrame();
          return runtimeStatus;
        })
        .then(completeBoot)
        .catch((error) => window.showToast(`Error launching chat interface: ${error.message}`));
    };

    if (performanceSettings?.effectiveLowPerformanceMode || reducedMotion) {
      launchAfterWarmStart(hasBootedThisSession ? WARM_CHAT_BOOT_MIN_MS : FIRST_CHAT_BOOT_MIN_MS);
      return;
    }

    if (hasBootedThisSession) {
      launchAfterWarmStart(WARM_CHAT_BOOT_MIN_MS);
      return;
    }

    window.showScreen('loading-screen');
    stageChatBehindLoader();
    if (desktopNavActions) desktopNavActions.replaceChildren();

    const stylesReady = warmCriticalStyles(BOOT_TASK_TIMEOUT_MS);
    const fontsReady = warmCriticalFonts(BOOT_TASK_TIMEOUT_MS);
    const assetsReady = warmShellAssets(BOOT_TASK_TIMEOUT_MS);
    const runtimeReady = prepareChatRuntime(FIRST_CHAT_BOOT_MIN_MS);

    const bootLines = [
      { scope: 'theme', action: 'resolve', target: 'css-graph', note: 'app styles', run: () => stylesReady },
      { scope: 'font', action: 'warm', target: 'brand-type', note: 'swap-safe text', run: () => fontsReady },
      { scope: 'asset', action: 'cache', target: 'icons+manifest', note: 'logo pack ready', run: () => assetsReady },
      { scope: 'runtime', action: 'bind', target: 'chat-core', note: 'listeners + composer', run: () => runtimeReady },
      { scope: 'surface', action: 'paint', target: 'minimalist.ui', note: 'handoff frame', run: () => Promise.allSettled([stylesReady, fontsReady, assetsReady, runtimeReady]).then(nextFrame) },
    ];

    const seqContainer = document.getElementById('boot-sequence');
    if (!seqContainer) {
      runtimeReady
        .then(completeBoot)
        .catch((error) => window.showToast(`Error launching chat interface: ${error.message}`));
      return;
    }

    if (!bootSequenceRoot) {
      seqContainer.replaceChildren();
      bootSequenceRoot = createRoot(seqContainer);
    }
    let visibleCount = 0;
    let completedCount = 0;
    const bootLineWork = bootLines.map((line) => Promise.resolve().then(() => line.run?.()));

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
        const lineIndex = visibleCount;
        visibleCount += 1;
        completedCount = visibleCount - 1;
        renderBootSequence();
        await bootLineWork[lineIndex];
        completedCount = visibleCount;
        renderBootSequence();
        await nextFrame();
        await showNextLine();
        return;
      }

      const loader = document.getElementById('loading-screen');
      if (!loader) {
        runtimeReady
          .then(completeBoot)
          .catch((error) => window.showToast(`Error launching chat interface: ${error.message}`));
        return;
      }

      loader.style.opacity = '0';
      window.setTimeout(() => {
        runtimeReady
          .then(completeBoot)
          .catch((error) => window.showToast(`Error launching chat interface: ${error.message}`));
        loader.classList.add('hidden');
        loader.style.opacity = '1';
      }, reducedMotion ? 0 : BOOT_FADE_MS);
    };

    window.setTimeout(showNextLine, 32);
  } catch (error) {
    window.showToast(`Error launching chat interface: ${error.message}`);
  }
};
