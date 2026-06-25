import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BootSequence } from './BootSequence.jsx';

let bootSequenceRoot = null;

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
      { scope: 'core', action: 'init', target: 'runtime', note: 'hydrate shell' },
      { scope: 'security', action: 'mount', target: 'protocols', note: 'attach guards' },
      { scope: 'socket', action: 'connect', target: 'realtime', note: 'open channel' },
      { scope: 'auth', action: 'verify', target: 'identity', note: 'check session' },
      { scope: 'module', action: 'load', target: 'auth.js', note: 'resolve user' },
      { scope: 'module', action: 'load', target: 'rooms.js', note: 'map rooms' },
      { scope: 'module', action: 'load', target: 'chat.js', note: 'bind composer' },
      { scope: 'database', action: 'sync', target: 'firebase', note: 'merge state' },
      { scope: 'system', action: 'ready', target: 'minimalist', note: 'handoff ui' },
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

    const showNextLine = () => {
      if (visibleCount > 0) {
        completedCount = visibleCount;
        renderBootSequence();
      }

      if (visibleCount < bootLines.length) {
        const isLast = visibleCount === bootLines.length - 1;
        visibleCount += 1;
        completedCount = visibleCount - 1;
        renderBootSequence();
        const delay = isLast ? 800 : Math.floor(Math.random() * 200) + 100;
        setTimeout(showNextLine, delay);
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
