function closeFloatingUI({ keep = '' } = {}) {
  const closeUnless = (id) => {
    if (keep === id) return;
    if (id === 'contacts-panel' && typeof window.closeContactsPanel === 'function') {
      window.closeContactsPanel();
      return;
    }
    if (id === 'bookmarks-panel' && typeof window.closeBookmarksPanel === 'function') {
      window.closeBookmarksPanel();
      return;
    }
    const el = document.getElementById(id);
    if (!el) return;
    if (id.endsWith('-modal') || id === 'settings-modal' || id === 'search-modal' || id === 'bookmarks-panel') el.classList.add('hidden');
    else el.classList.remove('open');
  };

  [
    'contacts-panel',
    'updates-panel',
    'personal-ai-agent-panel',
    'vault-panel',
    'bookmarks-panel',
    'settings-modal',
    'room-settings-modal',
    'room-action-modal',
    'room-invite-modal',
    'leave-room-modal',
    'delete-room-modal',
    'mute-user-modal',
    'admin-dashboard-modal',
    'search-modal',
  ].forEach(closeUnless);

  document.getElementById('room-settings-dropdown')?.classList.add('hidden');
  document.getElementById('room-add-page-menu')?.classList.add('hidden');
  document.getElementById('emoji-picker')?.classList.add('hidden');
  document.getElementById('user-profile-popup')?.classList.add('hidden');

  if (!keep || keep !== 'settings-modal') document.getElementById('modal-overlay')?.classList.add('hidden');
}

window.closeFloatingUI = closeFloatingUI;

function syncRoomChannelBar(targetView = document.querySelector('.room-tab.active')?.getAttribute('data-target')) {
  const channelBar = document.getElementById('room-channel-bar');
  if (!channelBar) return;
  const shouldShow = window.activeRoomId !== 'global' && targetView === 'chat';
  channelBar.classList.toggle('hidden', !shouldShow);
}

window.syncRoomChannelBar = syncRoomChannelBar;

function scrollMessagesToLatest(passes = 2) {
  if (typeof window.requestChatLatestScroll === 'function') {
    window.requestChatLatestScroll({ passes });
    return;
  }

  const scrollPass = (remainingPasses) => {
    requestAnimationFrame(() => {
      const messages = document.getElementById('messages');
      if (messages) messages.scrollTop = messages.scrollHeight;
      if (remainingPasses > 0) scrollPass(remainingPasses - 1);
    });
  };

  scrollPass(Math.max(0, passes - 1));
  [120, 320, 700, 1200, 1800].forEach((delay) => {
    window.setTimeout(() => scrollPass(1), delay);
  });
}

window.scrollMessagesToLatest = scrollMessagesToLatest;

function activateRoomView(targetView = 'chat') {
  const targetTab = Array.from(document.querySelectorAll('.room-tab')).find((tab) => tab.getAttribute('data-target') === targetView);

  document.querySelectorAll('.room-tab').forEach((tab) => {
    tab.classList.toggle('active', tab === targetTab);
  });

  document.querySelectorAll('.room-view').forEach((view) => view.classList.add('hidden'));
  document.getElementById(`room-view-${targetView}`)?.classList.remove('hidden');
  syncRoomChannelBar(targetView);

  if (targetView === 'chat') {
    scrollMessagesToLatest(2);
  }

  const loaders = {
    home: window.loadRoomHome,
    docs: window.loadRoomDocs,
    whiteboard: window.loadRoomWhiteboard,
    tasks: window.loadRoomTasks,
    events: window.loadRoomEvents,
    calendar: window.loadRoomCalendar,
    ai: window.loadRoomAI,
    calls: window.loadRoomCalls,
  };

  if (loaders[targetView]) loaders[targetView]();
}

window.activateRoomView = activateRoomView;

const ROOM_COLLAPSE_STORAGE_KEY = 'minimalist.roomsCollapsed';
let roomCollapseTimer = null;

function prefersReducedRoomMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

function setRoomCollapseStagger() {
  const roomItems = Array.from(document.querySelectorAll('#desktop-room-sidebar .room-item'));
  roomItems.forEach((item, index) => {
    item.style.setProperty('--room-stagger', `${Math.min(index * 18, 144)}ms`);
  });
}

function syncRoomCollapseButton(collapsed) {
  const button = document.getElementById('toggle-rooms-collapse-btn');
  if (!button) return;

  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? 'Expand rooms' : 'Collapse rooms');
  button.setAttribute('title', collapsed ? 'Expand rooms' : 'Collapse rooms');
  button.classList.toggle('is-collapsed', collapsed);
}

function setRoomsCollapsed(nextCollapsed, { persist = true, animate = true } = {}) {
  const wrapper = document.getElementById('chat-wrapper');
  if (!wrapper) return;

  const collapsed = Boolean(nextCollapsed);
  setRoomCollapseStagger();

  if (roomCollapseTimer) window.clearTimeout(roomCollapseTimer);
  wrapper.classList.remove('rooms-expanding', 'rooms-collapsing');
  wrapper.classList.toggle('room-collapse-animating', animate && !prefersReducedRoomMotion());
  wrapper.classList.toggle('rooms-collapsed', collapsed);
  if (animate && !prefersReducedRoomMotion()) {
    wrapper.classList.add(collapsed ? 'rooms-collapsing' : 'rooms-expanding');
  }
  syncRoomCollapseButton(collapsed);

  if (persist) {
    try {
      window.localStorage?.setItem(ROOM_COLLAPSE_STORAGE_KEY, collapsed ? 'true' : 'false');
    } catch (error) {
      // Storage can be unavailable in private browsing; the UI should still animate.
    }
  }

  if (animate && !prefersReducedRoomMotion()) {
    roomCollapseTimer = window.setTimeout(() => {
      wrapper.classList.remove('room-collapse-animating', 'rooms-expanding', 'rooms-collapsing');
      roomCollapseTimer = null;
    }, 640);
  } else {
    wrapper.classList.remove('room-collapse-animating', 'rooms-expanding', 'rooms-collapsing');
  }
}

function hydrateRoomCollapsePreference() {
  const wrapper = document.getElementById('chat-wrapper');
  if (!wrapper) return;

  let collapsed = false;
  try {
    collapsed = window.localStorage?.getItem(ROOM_COLLAPSE_STORAGE_KEY) === 'true';
  } catch (error) {
    collapsed = false;
  }

  setRoomsCollapsed(collapsed, { persist: false, animate: false });
}

window.setRoomsCollapsed = setRoomsCollapsed;
window.hydrateRoomCollapsePreference = hydrateRoomCollapsePreference;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrateRoomCollapsePreference, { once: true });
} else {
  window.requestAnimationFrame(hydrateRoomCollapsePreference);
}

document.addEventListener('click', (event) => {
  if (event.target.closest('#mobile-back-to-rooms')) {
    document.getElementById('desktop-room-sidebar')?.classList.add('open');
  }

  if (event.target.closest('.room-item')) {
    const roomSearch = document.getElementById('room-search-input');
    if (roomSearch) roomSearch.value = '';
  }

  if (['tab-notifications', 'tab-changelog', 'tab-leaderboard', 'tab-recognition', 'tab-quests'].includes(event.target.id)) {
    ['tab-notifications', 'tab-changelog', 'tab-leaderboard', 'tab-recognition', 'tab-quests'].forEach((id) => {
      document.getElementById(id)?.classList.toggle('active', id === event.target.id);
    });

    document.getElementById('notifications-list')?.classList.toggle('hidden', event.target.id !== 'tab-notifications');
    document.getElementById('updates-list')?.classList.toggle('hidden', event.target.id !== 'tab-changelog');
    document.getElementById('leaderboard-list')?.classList.toggle('hidden', event.target.id !== 'tab-leaderboard');
    document.getElementById('recognition-list')?.classList.toggle('hidden', event.target.id !== 'tab-recognition');
    document.getElementById('quests-list')?.classList.toggle('hidden', event.target.id !== 'tab-quests');

    if (event.target.id === 'tab-leaderboard' && window.renderLeaderboard) window.renderLeaderboard();
    if (event.target.id === 'tab-recognition' && window.renderRecognition) window.renderRecognition();
    if (event.target.id === 'tab-quests' && window.renderQuests) window.renderQuests();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'pm-search-input') {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll('#pm-messages li').forEach((msg) => {
      const text = msg.textContent.toLowerCase();
      msg.style.display = text.includes(query) ? 'list-item' : 'none';
    });
  }

  if (event.target.id === 'contact-search-input') {
    if (window.renderContactsUI) window.renderContactsUI();
  }
});

document.addEventListener('click', (event) => {
  const profilePopup = document.getElementById('user-profile-popup');
  if (profilePopup && !profilePopup.classList.contains('hidden')) {
    if (
      !event.target.closest('#user-profile-popup')
      && !event.target.closest('.msg-avatar')
      && !event.target.closest('.msg-name')
      && !event.target.closest('.avatar-wrapper')
      && !event.target.closest('.contact-icon-btn')
      && !event.target.closest('#preview-profile-btn')
    ) {
      profilePopup.classList.add('hidden');

      const settings = document.getElementById('settings-modal');
      if (!settings || settings.classList.contains('hidden')) {
        document.getElementById('modal-overlay')?.classList.add('hidden');
      }
    }
  }

  if (event.target.id === 'modal-overlay') {
    const modals = [
      'room-action-modal',
      'room-settings-modal',
      'room-invite-modal',
      'leave-room-modal',
      'delete-room-modal',
      'mute-user-modal',
      'admin-dashboard-modal',
    ];
    modals.forEach((id) => document.getElementById(id)?.classList.add('hidden'));

    const settings = document.getElementById('settings-modal');
    if (!settings || settings.classList.contains('hidden')) {
      document.getElementById('modal-overlay')?.classList.add('hidden');
    }
  }
});

document.addEventListener('click', (event) => {
  const isRooms = event.target.closest('#open-rooms-btn-mobile');
  const isContacts = event.target.closest('#open-contacts-btn') || event.target.closest('#open-contacts-btn-mobile');
  const isPersonalAgent = event.target.closest('#open-personal-agent-btn');
  const isVault = event.target.closest('#open-vault-btn') || event.target.closest('#open-vault-btn-mobile');
  const isUpdates = event.target.closest('#open-updates-btn-desktop') || event.target.closest('#open-updates-btn-mobile');
  const isBookmarks = event.target.closest('#open-bookmarks-btn');
  const isSettings = event.target.closest('#open-settings-btn') || event.target.closest('#open-settings-btn-mobile');

  if (!(isRooms || isContacts || isPersonalAgent || isVault || isUpdates || isBookmarks || isSettings)) return;

  event.stopImmediatePropagation();
  event.preventDefault();

  const roomsSidebar = document.getElementById('desktop-room-sidebar');
  const contactsPanel = document.getElementById('contacts-panel');
  const personalAgentPanel = document.getElementById('personal-ai-agent-panel');
  const vaultPanel = document.getElementById('vault-panel');
  const updatesPanel = document.getElementById('updates-panel');
  const bookmarksPanel = document.getElementById('bookmarks-panel');
  const settingsModal = document.getElementById('settings-modal');

  const wasRoomsOpen = roomsSidebar?.classList.contains('open');
  const wasContactsOpen = contactsPanel?.classList.contains('open');
  const wasPersonalAgentOpen = personalAgentPanel?.classList.contains('open');
  const wasVaultOpen = vaultPanel?.classList.contains('open');
  const wasUpdatesOpen = updatesPanel?.classList.contains('open');
  const wasBookmarksOpen = bookmarksPanel && !bookmarksPanel.classList.contains('hidden');
  const wasSettingsOpen = settingsModal && !settingsModal.classList.contains('hidden');

  if (isBookmarks) {
    closeFloatingUI({ keep: 'vault-panel' });
    roomsSidebar?.classList.remove('open');
    window.openVault?.('saved');
    return;
  }

  // Only "keep" the clicked panel when it was closed (we're about to open it).
  // If it was already open, keep nothing so closeFloatingUI closes it and the
  // !wasXOpen guards below skip re-opening — i.e. clicking again toggles it shut.
  closeFloatingUI({ keep: isContacts && !wasContactsOpen ? 'contacts-panel' : isPersonalAgent && !wasPersonalAgentOpen ? 'personal-ai-agent-panel' : isVault && !wasVaultOpen ? 'vault-panel' : isUpdates && !wasUpdatesOpen ? 'updates-panel' : isBookmarks && !wasBookmarksOpen ? 'bookmarks-panel' : isSettings && !wasSettingsOpen ? 'settings-modal' : isRooms && !wasRoomsOpen ? 'desktop-room-sidebar' : '' });
  roomsSidebar?.classList.remove('open');

  if (isRooms && !wasRoomsOpen && roomsSidebar) roomsSidebar.classList.add('open');

  if (isContacts && !wasContactsOpen) {
    if (window.toggleContacts) window.toggleContacts();
  }

  if (isPersonalAgent && !wasPersonalAgentOpen) {
    if (window.openPersonalAgent) window.openPersonalAgent();
  }

  if (isVault && !wasVaultOpen) {
    if (window.openVault) window.openVault();
  }

  if (isUpdates && !wasUpdatesOpen && updatesPanel) {
    updatesPanel.classList.add('open');
    if (window.fetchGitHubUpdates) window.fetchGitHubUpdates();
  }

  if (isBookmarks && !wasBookmarksOpen) {
    window.openBookmarks?.();
  }

  if (isSettings && !wasSettingsOpen) {
    if (window.openSettings) window.openSettings();
  }
}, true);

document.addEventListener('click', (event) => {
  if (event.target.closest('#close-personal-agent-btn')) {
    document.getElementById('personal-ai-agent-panel')?.classList.remove('open');
  }

  if (event.target.closest('#close-vault-btn')) {
    document.getElementById('vault-panel')?.classList.remove('open');
  }

  if (event.target.closest('#toggle-rooms-collapse-btn')) {
    const wrapper = document.getElementById('chat-wrapper');
    setRoomsCollapsed(!wrapper?.classList.contains('rooms-collapsed'));
  }
});

document.addEventListener('click', (event) => {
  const samePageChatLink = event.target.closest('a[href="/chat"]');
  if (samePageChatLink && window.location.pathname.includes('/chat')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeFloatingUI();
    activateRoomView('chat');
    scrollMessagesToLatest(2);
    return;
  }
}, true);

document.addEventListener('click', (event) => {
  if (!event.target.closest('#toggle-room-search-btn')) return;

  const searchInput = document.getElementById('room-search-input');
  if (!searchInput) return;

  searchInput.classList.toggle('open');
  if (searchInput.classList.contains('open')) {
    searchInput.focus();
    return;
  }

  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
});

document.addEventListener('click', (event) => {
  const tabBtn = event.target.closest('.room-tab');
  if (!tabBtn) return;

  const targetView = tabBtn.getAttribute('data-target');
  const activeView = document.querySelector('.room-tab.active')?.getAttribute('data-target');

  if (targetView && targetView === activeView) {
    closeFloatingUI();
    syncRoomChannelBar(targetView);
    if (targetView === 'chat') scrollMessagesToLatest(2);
    return;
  }

  closeFloatingUI();
  activateRoomView(targetView);
});

window.onRoomChanged = function onRoomChanged() {
  const defaultView = window.isSimpleFeatureMode?.() ? 'chat' : window.activeRoomId === 'global' ? 'chat' : 'home';

  document.querySelectorAll('.room-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-target') === defaultView);
  });
  document.querySelectorAll('.room-view').forEach((view) => view.classList.add('hidden'));
  document.getElementById(`room-view-${defaultView}`)?.classList.remove('hidden');
  syncRoomChannelBar(defaultView);

  if (window.renderRoomPages) window.renderRoomPages();
  if (defaultView === 'home' && window.loadRoomHome) window.loadRoomHome();
};
