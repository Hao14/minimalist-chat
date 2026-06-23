window.enterChat = function enterChat() {
  try {
    const desktopNavActions = document.getElementById('nav-actions');

    const launchChatUI = () => {
      window.showScreen('chat-wrapper');

      if (window.chatInitialized) return;

      if (window.initializeRooms) window.initializeRooms();
      window.listenForPmInbox();
      window.listenForNotifications();
      if (window.initializePresence) window.initializePresence();
      if (window.initMessageTools) window.initMessageTools();
      window.chatInitialized = true;
      if (window.maybeShowWelcomeTour) window.maybeShowWelcomeTour();

      const pendingJoin = sessionStorage.getItem('pendingJoinUrl');
      const currentPath = window.location.pathname;
      const pathToCheck = pendingJoin || currentPath;

      if (pathToCheck.includes('/join/')) {
        const urlCode = pathToCheck.split('/join/').pop();
        if (urlCode && document.getElementById('room-action-modal')) {
          document.getElementById('room-action-title').textContent = 'Join Room';
          document.getElementById('room-action-label').textContent = 'INVITE LINK OR CODE';
          document.getElementById('room-action-input').value = urlCode;
          document.getElementById('room-action-submit').textContent = 'Join';
          document.getElementById('room-action-modal').classList.remove('hidden');

          sessionStorage.removeItem('pendingJoinUrl');
          if (currentPath.includes('/join/')) window.history.pushState({}, '', '/chat');
        }
      }

      const profileRef = new URLSearchParams(window.location.search).get('profile');
      if (profileRef && window.openProfileByRef) {
        setTimeout(() => window.openProfileByRef(profileRef), 900);
        window.history.replaceState({}, '', '/chat');
      }
    };

    if (sessionStorage.getItem('blipLoaded') === 'true') {
      launchChatUI();
      return;
    }

    window.showScreen('loading-screen');
    if (desktopNavActions) desktopNavActions.innerHTML = '';

    const bootLines = [
      'Initializing core system...',
      'Mounting secure protocols...',
      'Establishing socket connection...',
      'Verifying user identity...',
      'Loading module: auth.js...',
      'Loading module: rooms.js...',
      'Loading module: chat.js...',
      'Syncing realtime database...',
      'System ready.',
    ];

    const seqContainer = document.getElementById('boot-sequence');
    if (!seqContainer) {
      setTimeout(() => {
        sessionStorage.setItem('blipLoaded', 'true');
        launchChatUI();
      }, 2000);
      return;
    }

    seqContainer.innerHTML = '';
    let currentLine = 0;

    const showNextLine = () => {
      if (currentLine > 0) {
        const prev = document.getElementById(`boot-line-${currentLine - 1}`);
        if (prev) {
          prev.querySelector('.boot-prefix').textContent = '✓';
          prev.querySelector('.boot-cursor')?.remove();
        }
      }

      if (currentLine < bootLines.length) {
        const li = document.createElement('div');
        li.id = `boot-line-${currentLine}`;
        li.className = 'boot-line';
        li.innerHTML = `<span class="boot-prefix">›</span><span class="boot-text">${bootLines[currentLine]}</span><span class="boot-cursor"></span>`;
        seqContainer.appendChild(li);

        const isLast = currentLine === bootLines.length - 1;
        currentLine += 1;
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
