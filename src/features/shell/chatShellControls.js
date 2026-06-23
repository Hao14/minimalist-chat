function closeFloatingUI({ keep = '' } = {}) {
  const closeUnless = (id) => {
    if (keep === id) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (id.endsWith('-modal') || id === 'settings-modal' || id === 'search-modal') el.classList.add('hidden');
    else el.classList.remove('open');
  };

  [
    'contacts-panel',
    'updates-panel',
    'personal-ai-agent-panel',
    'settings-modal',
    'room-settings-modal',
    'room-action-modal',
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

document.addEventListener('click', (event) => {
  if (event.target.closest('#mobile-back-to-rooms')) {
    document.getElementById('desktop-room-sidebar')?.classList.add('open');
  }

  if (event.target.closest('.room-item')) {
    const roomSearch = document.getElementById('room-search-input');
    if (roomSearch) roomSearch.value = '';
  }

  if (['tab-notifications', 'tab-changelog', 'tab-leaderboard', 'tab-quests'].includes(event.target.id)) {
    ['tab-notifications', 'tab-changelog', 'tab-leaderboard', 'tab-quests'].forEach((id) => {
      document.getElementById(id)?.classList.toggle('active', id === event.target.id);
    });

    document.getElementById('notifications-list')?.classList.toggle('hidden', event.target.id !== 'tab-notifications');
    document.getElementById('updates-list')?.classList.toggle('hidden', event.target.id !== 'tab-changelog');
    document.getElementById('leaderboard-list')?.classList.toggle('hidden', event.target.id !== 'tab-leaderboard');
    document.getElementById('quests-list')?.classList.toggle('hidden', event.target.id !== 'tab-quests');

    if (event.target.id === 'tab-leaderboard' && window.renderLeaderboard) window.renderLeaderboard();
    if (event.target.id === 'tab-quests' && window.renderQuests) window.renderQuests();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'room-search-input') {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll('#messages li').forEach((msg) => {
      const text = msg.textContent.toLowerCase();
      msg.style.display = text.includes(query) ? 'flex' : 'none';
    });
  }

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
  const isUpdates = event.target.closest('#open-updates-btn-desktop') || event.target.closest('#open-updates-btn-mobile');
  const isSettings = event.target.closest('#open-settings-btn') || event.target.closest('#open-settings-btn-mobile');

  if (!(isRooms || isContacts || isPersonalAgent || isUpdates || isSettings)) return;

  event.stopImmediatePropagation();
  event.preventDefault();

  const roomsSidebar = document.getElementById('desktop-room-sidebar');
  const contactsPanel = document.getElementById('contacts-panel');
  const personalAgentPanel = document.getElementById('personal-ai-agent-panel');
  const updatesPanel = document.getElementById('updates-panel');
  const settingsModal = document.getElementById('settings-modal');

  const wasRoomsOpen = roomsSidebar?.classList.contains('open');
  const wasContactsOpen = contactsPanel?.classList.contains('open');
  const wasPersonalAgentOpen = personalAgentPanel?.classList.contains('open');
  const wasUpdatesOpen = updatesPanel?.classList.contains('open');
  const wasSettingsOpen = settingsModal && !settingsModal.classList.contains('hidden');

  closeFloatingUI({ keep: isContacts ? 'contacts-panel' : isPersonalAgent ? 'personal-ai-agent-panel' : isUpdates ? 'updates-panel' : isSettings ? 'settings-modal' : isRooms ? 'desktop-room-sidebar' : '' });
  roomsSidebar?.classList.remove('open');

  if (isRooms && !wasRoomsOpen && roomsSidebar) roomsSidebar.classList.add('open');

  if (isContacts && !wasContactsOpen) {
    if (window.toggleContacts) window.toggleContacts();
  }

  if (isPersonalAgent && !wasPersonalAgentOpen) {
    if (window.openPersonalAgent) window.openPersonalAgent();
  }

  if (isUpdates && !wasUpdatesOpen && updatesPanel) {
    updatesPanel.classList.add('open');
    if (window.fetchGitHubUpdates) window.fetchGitHubUpdates();
  }

  if (isSettings && !wasSettingsOpen) {
    if (window.openSettings) window.openSettings();
  }
}, true);

document.addEventListener('click', (event) => {
  if (event.target.closest('#close-personal-agent-btn')) {
    document.getElementById('personal-ai-agent-panel')?.classList.remove('open');
  }

  if (event.target.closest('#toggle-rooms-collapse-btn')) {
    const wrapper = document.getElementById('chat-wrapper');
    wrapper?.classList.toggle('rooms-collapsed');
  }
});

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

  closeFloatingUI();

  const targetView = tabBtn.getAttribute('data-target');

  document.querySelectorAll('.room-tab').forEach((tab) => tab.classList.remove('active'));
  tabBtn.classList.add('active');

  document.querySelectorAll('.room-view').forEach((view) => view.classList.add('hidden'));
  document.getElementById(`room-view-${targetView}`)?.classList.remove('hidden');

  if (targetView === 'chat') {
    const messages = document.getElementById('messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
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
});

window.onRoomChanged = function onRoomChanged() {
  const defaultView = window.activeRoomId === 'global' ? 'chat' : 'home';

  document.querySelectorAll('.room-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-target') === defaultView);
  });
  document.querySelectorAll('.room-view').forEach((view) => view.classList.add('hidden'));
  document.getElementById(`room-view-${defaultView}`)?.classList.remove('hidden');

  if (window.renderRoomPages) window.renderRoomPages();
  if (defaultView === 'home' && window.loadRoomHome) window.loadRoomHome();
};
