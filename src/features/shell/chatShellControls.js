import { ROOM_TAB_CHANGE_EVENT } from './roomTabActivity.js';

const UPDATE_PANELS = {
  'tab-notifications': 'notifications-list',
  'tab-quests': 'quests-list',
  'tab-leaderboard': 'leaderboard-list',
  'tab-recognition': 'recognition-list',
  'tab-changelog': 'updates-list',
};

const UPDATE_TAB_ALIASES = {
  activity: 'tab-notifications',
  notifications: 'tab-notifications',
  quests: 'tab-quests',
  leaderboard: 'tab-leaderboard',
  ranks: 'tab-leaderboard',
  recognition: 'tab-recognition',
  kudos: 'tab-recognition',
  changelog: 'tab-changelog',
  updates: 'tab-changelog',
  'whats-new': 'tab-changelog',
};

let updatesLastFocus = null;
let mobileDockObserver = null;
let vaultLastFocus = null;

function setAttributeIfChanged(element, name, value) {
  if (!element || element.getAttribute(name) === value) return;
  element.setAttribute(name, value);
}

function mobileDockSurfaceIsOpen(id, { className = 'open' } = {}) {
  const element = document.getElementById(id);
  if (!element) return false;
  if (className) return element.classList.contains(className);
  return isVisibleElement(element);
}

function syncMobileDockState() {
  const dock = document.getElementById('mobile-nav-links');
  if (!dock) return;

  const roomsSidebar = document.getElementById('desktop-room-sidebar');
  const contactsOpen = mobileDockSurfaceIsOpen('contacts-panel') || mobileDockSurfaceIsOpen('pm-popup', { className: '' });
  const personalAgentOpen = mobileDockSurfaceIsOpen('personal-ai-agent-panel');
  const updatesOpen = mobileDockSurfaceIsOpen('updates-panel');
  const searchOpen = mobileDockSurfaceIsOpen('search-modal', { className: '' });
  const vaultOpen = mobileDockSurfaceIsOpen('vault-panel');
  const settingsOpen = mobileDockSurfaceIsOpen('settings-modal', { className: '' });
  const moreMenu = document.getElementById('mobile-dock-more-menu');
  const moreMenuOpen = Boolean(moreMenu && !moreMenu.classList.contains('hidden'));

  let activeAction = 'rooms';
  if (moreMenuOpen) activeAction = 'more';
  else if (contactsOpen) activeAction = 'contacts';
  else if (personalAgentOpen) activeAction = 'personal-agent';
  else if (updatesOpen) activeAction = 'updates';
  else if (searchOpen || vaultOpen || settingsOpen) activeAction = 'more';

  dock.querySelectorAll('[data-mobile-dock-action]').forEach((button) => {
    const active = button.dataset.mobileDockAction === activeAction;
    button.classList.toggle('active', active);
    if (active) setAttributeIfChanged(button, 'aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  const expansionState = {
    'open-rooms-btn-mobile': Boolean(roomsSidebar?.classList.contains('open')),
    'open-contacts-btn-mobile': contactsOpen,
    'open-personal-agent-btn-mobile': personalAgentOpen,
    'open-updates-btn-mobile': updatesOpen,
    'open-more-btn-mobile': moreMenuOpen,
    'open-search-btn-mobile': searchOpen,
    'open-vault-btn-mobile': vaultOpen,
    'open-settings-btn-mobile': settingsOpen,
  };
  Object.entries(expansionState).forEach(([id, expanded]) => {
    setAttributeIfChanged(document.getElementById(id), 'aria-expanded', String(expanded));
  });

  document.getElementById('open-search-btn')?.setAttribute('aria-expanded', String(searchOpen));
  document.getElementById('open-vault-btn')?.setAttribute('aria-expanded', String(vaultOpen));
  document.getElementById('open-settings-btn')?.setAttribute('aria-expanded', String(settingsOpen));

  document.getElementById('open-search-btn-mobile')?.classList.toggle('active', searchOpen);
  document.getElementById('open-vault-btn-mobile')?.classList.toggle('active', vaultOpen);
  document.getElementById('open-settings-btn-mobile')?.classList.toggle('active', settingsOpen);

  if (window.matchMedia?.('(max-width: 768px)').matches) {
    setAttributeIfChanged(roomsSidebar, 'aria-hidden', String(!roomsSidebar?.classList.contains('open')));
  } else {
    roomsSidebar?.removeAttribute('aria-hidden');
  }
}

function setMobileDockMoreOpen(open, { focusFirst = false, restoreFocus = false } = {}) {
  const menu = document.getElementById('mobile-dock-more-menu');
  const trigger = document.getElementById('open-more-btn-mobile');
  if (!menu || !trigger) return false;

  const nextOpen = Boolean(open) && window.matchMedia?.('(max-width: 768px)').matches !== false;
  menu.classList.toggle('hidden', !nextOpen);
  setAttributeIfChanged(menu, 'aria-hidden', String(!nextOpen));
  setAttributeIfChanged(trigger, 'aria-expanded', String(nextOpen));
  document.body.classList.toggle('mobile-dock-more-open', nextOpen);
  syncMobileDockState();

  if (nextOpen && focusFirst) {
    window.requestAnimationFrame(() => menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus());
  } else if (!nextOpen && restoreFocus) {
    window.requestAnimationFrame(() => trigger.focus());
  }
  return true;
}

window.closeMobileDockMoreMenu = ({ restoreFocus = false } = {}) => {
  setMobileDockMoreOpen(false, { restoreFocus });
};

function setVaultPanelOpenState(open) {
  const panel = document.getElementById('vault-panel');
  setAttributeIfChanged(panel, 'aria-hidden', String(!open));
  ['open-vault-btn', 'open-vault-btn-mobile'].forEach((id) => {
    setAttributeIfChanged(document.getElementById(id), 'aria-expanded', String(open));
  });
  syncMobileDockState();
}

function closeVaultPanel({ restoreFocus = false } = {}) {
  const panel = document.getElementById('vault-panel');
  const wasOpen = panel?.classList.contains('open');
  const returnFocus = vaultLastFocus;
  panel?.classList.remove('open');
  setVaultPanelOpenState(false);
  if (wasOpen && restoreFocus && returnFocus?.isConnected) {
    window.requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
  }
  vaultLastFocus = null;
}

window.setVaultPanelOpenState = setVaultPanelOpenState;
window.closeVaultPanel = closeVaultPanel;

function setupMobileDockState() {
  const dock = document.getElementById('mobile-nav-links');
  if (!dock || dock.dataset.mobileDockBound === 'true') return;
  dock.dataset.mobileDockBound = 'true';

  const observedIds = [
    'desktop-room-sidebar',
    'contacts-panel',
    'pm-popup',
    'personal-ai-agent-panel',
    'updates-panel',
    'vault-panel',
    'settings-modal',
    'search-modal',
    'mobile-dock-more-menu',
  ];
  mobileDockObserver?.disconnect();
  mobileDockObserver = new MutationObserver(syncMobileDockState);
  observedIds.forEach((id) => {
    const element = document.getElementById(id);
    if (element) mobileDockObserver.observe(element, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  });

  const desktopQuery = window.matchMedia?.('(min-width: 769px)');
  desktopQuery?.addEventListener?.('change', (event) => {
    if (event.matches) setMobileDockMoreOpen(false);
    syncMobileDockState();
  });
  syncMobileDockState();
}

function syncUpdatesOpenState(isOpen) {
  const panel = document.getElementById('updates-panel');
  panel?.setAttribute('aria-hidden', String(!isOpen));
  ['open-updates-btn-desktop', 'open-updates-btn-mobile'].forEach((id) => {
    document.getElementById(id)?.setAttribute('aria-expanded', String(isOpen));
  });
  document.body.classList.toggle('updates-center-open', isOpen);
}

function resolveUpdatesTab(tab) {
  const requested = String(tab || '').trim().toLowerCase();
  if (UPDATE_PANELS[tab]) return tab;
  return UPDATE_TAB_ALIASES[requested] || 'tab-notifications';
}

function activateUpdatesTab(tab, { focus = false } = {}) {
  const tabId = resolveUpdatesTab(tab);
  Object.entries(UPDATE_PANELS).forEach(([candidateTabId, panelId]) => {
    const isActive = candidateTabId === tabId;
    const candidateTab = document.getElementById(candidateTabId);
    const panel = document.getElementById(panelId);
    candidateTab?.classList.toggle('active', isActive);
    candidateTab?.setAttribute('aria-selected', String(isActive));
    if (candidateTab) candidateTab.tabIndex = isActive ? 0 : -1;
    panel?.classList.toggle('hidden', !isActive);
    panel?.setAttribute('aria-hidden', String(!isActive));
  });

  const updatesPanel = document.getElementById('updates-panel');
  updatesPanel?.setAttribute('data-active-section', tabId.replace(/^tab-/, ''));
  if (tabId === 'tab-leaderboard') window.renderLeaderboard?.();
  else if (tabId === 'tab-recognition') window.renderRecognition?.();
  else if (tabId === 'tab-quests') window.renderQuests?.();
  else if (tabId === 'tab-changelog') window.fetchGitHubUpdates?.();
  else window.renderNotificationActivity?.();

  if (tabId !== 'tab-quests') window.stopQuestLiveSync?.();
  if (tabId !== 'tab-changelog') window.stopGitHubUpdates?.();
  if (focus) document.getElementById(tabId)?.focus();
  return tabId;
}

function closeUpdatesPanel({ restoreFocus = true } = {}) {
  const panel = document.getElementById('updates-panel');
  const wasOpen = panel?.classList.contains('open');
  const returnFocus = updatesLastFocus;
  panel?.classList.remove('open');
  syncUpdatesOpenState(false);
  window.stopQuestLiveSync?.();
  window.stopGitHubUpdates?.();

  if (wasOpen && restoreFocus && returnFocus?.isConnected) {
    window.requestAnimationFrame(() => returnFocus.focus());
  }
  updatesLastFocus = null;
}

window.closeUpdatesPanel = closeUpdatesPanel;
window.setUpdatesTab = activateUpdatesTab;

window.openUpdatesPanel = function openUpdatesPanel({ closeOthers = true, focus = true, opener, tab } = {}) {
  const panel = document.getElementById('updates-panel');
  if (!panel) return false;
  if (closeOthers) closeFloatingUI({ keep: 'updates-panel' });

  if (!panel.classList.contains('open')) {
    const candidate = opener instanceof HTMLElement ? opener : document.activeElement;
    updatesLastFocus = candidate instanceof HTMLElement && !panel.contains(candidate) ? candidate : null;
  }

  panel.classList.add('open');
  syncUpdatesOpenState(true);
  const activeTab = tab || panel.querySelector('.update-tab.active')?.id || 'tab-notifications';
  activateUpdatesTab(activeTab);
  if (focus) document.getElementById('close-updates-btn')?.focus();
  return true;
};

function closeFloatingUI({ keep = '', restoreFocus = false } = {}) {
  const closeUnless = (id) => {
    if (keep === id) return;
    if (id === 'pm-popup') {
      if (typeof window.closePrivateChatDock === 'function') window.closePrivateChatDock({ restoreOrigin: false });
      else document.getElementById(id)?.classList.add('hidden');
      return;
    }
    if (id === 'contacts-panel' && typeof window.closeContactsPanel === 'function') {
      document.getElementById(id)?.classList.remove('open');
      window.closeContactsPanel();
      return;
    }
    if (id === 'personal-ai-agent-panel' && typeof window.closePersonalAgent === 'function') {
      window.closePersonalAgent({ restoreFocus });
      return;
    }
    if (id === 'vault-panel') {
      closeVaultPanel({ restoreFocus });
      return;
    }
    if (id === 'bookmarks-panel' && typeof window.closeBookmarksPanel === 'function') {
      window.closeBookmarksPanel();
      return;
    }
    if (id === 'updates-panel') {
      closeUpdatesPanel({ restoreFocus });
      return;
    }
    if (id === 'settings-modal' && typeof window.closeSettingsModal === 'function') {
      window.closeSettingsModal({ restoreFocus });
      return;
    }
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'search-modal') {
      window.dispatchEvent(new CustomEvent('minimalist:close-search'));
      el.classList.add('hidden');
      return;
    }
    if (id.endsWith('-modal') || id === 'settings-modal' || id === 'search-modal' || id === 'bookmarks-panel') el.classList.add('hidden');
    else el.classList.remove('open');
  };

  [
    'pm-popup',
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
  if (keep !== 'emoji-picker' && typeof window.closeEmojiPicker === 'function') window.closeEmojiPicker();
  else if (keep !== 'emoji-picker') document.getElementById('emoji-picker')?.classList.add('hidden');
  document.getElementById('custom-context-menu')?.classList.add('hidden');
  document.getElementById('profile-more-dropdown')?.classList.add('hidden');
  if (keep !== 'mobile-dock-more-menu') setMobileDockMoreOpen(false);
  if (typeof window.closeUserProfilePopup === 'function') {
    window.closeUserProfilePopup({ restoreFocus: false });
  } else {
    document.getElementById('user-profile-popup')?.classList.add('hidden');
  }

  if (!keep || keep !== 'settings-modal') document.getElementById('modal-overlay')?.classList.add('hidden');
}

window.closeFloatingUI = closeFloatingUI;

function eventTargetElement(event) {
  const target = event.target;
  if (target instanceof Element) return target;
  return target?.parentElement || null;
}

function syncRoomDropdownAccessibility() {
  const trigger = document.getElementById('room-name-wrapper');
  const dropdown = document.getElementById('room-settings-dropdown');
  if (!trigger || !dropdown) return;

  trigger.setAttribute('aria-expanded', String(!dropdown.classList.contains('hidden')));
}

function setupRoomDropdownAccessibility() {
  const trigger = document.getElementById('room-name-wrapper');
  const dropdown = document.getElementById('room-settings-dropdown');
  if (!trigger || !dropdown || dropdown.dataset.roomA11yBound === 'true') return;

  dropdown.dataset.roomA11yBound = 'true';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-controls', 'room-settings-dropdown');
  syncRoomDropdownAccessibility();

  const observer = new MutationObserver(syncRoomDropdownAccessibility);
  observer.observe(dropdown, { attributes: true, attributeFilter: ['class'] });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupRoomDropdownAccessibility();
    setupMobileDockState();
  }, { once: true });
} else {
  window.requestAnimationFrame(() => {
    setupRoomDropdownAccessibility();
    setupMobileDockState();
  });
}

function isVisibleElement(element) {
  if (!element || element.classList.contains('hidden')) return false;
  if (element.classList.contains('open')) return true;
  return element.offsetParent !== null || getComputedStyle(element).position === 'fixed';
}

function syncRoomViewAccessibility(activeView, targetTab) {
  const previousView = document.querySelector('.room-tab.active')?.getAttribute('data-target') || null;
  const previousRoomId = syncRoomViewAccessibility.lastRoomId || null;

  document.querySelectorAll('.room-tab').forEach((tab) => {
    const isActive = tab === targetTab;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  document.querySelectorAll('.room-view').forEach((view) => {
    const isActive = view.id === `room-view-${activeView}`;
    view.classList.toggle('active', isActive);
    view.classList.toggle('hidden', !isActive);
    view.setAttribute('aria-hidden', String(!isActive));
  });

  const roomId = window.activeRoomId || null;
  syncRoomViewAccessibility.lastRoomId = roomId;

  // Lazy room features use this one lifecycle event to pause live listeners and
  // timers while hidden. It also fires when the room changes but the tab does not.
  if (previousView !== activeView || previousRoomId !== roomId) {
    window.dispatchEvent(new CustomEvent(ROOM_TAB_CHANGE_EVENT, {
      detail: { activeView, previousView, roomId, previousRoomId },
    }));
  }
}

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

  syncRoomViewAccessibility(targetView, targetTab);
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

function allowSpeculativeRoomFeaturePreload() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData) return false;
  if (['slow-2g', '2g'].includes(String(connection?.effectiveType || '').toLowerCase())) return false;
  if (Number(navigator.deviceMemory || 4) <= 2) return false;
  return true;
}

function preloadRoomFeatureFromIntent(event, { explicit = false } = {}) {
  const tab = eventTargetElement(event)?.closest('.room-tab[data-target]');
  const view = tab?.getAttribute('data-target');
  if (!view || view === 'chat' || (!explicit && !allowSpeculativeRoomFeaturePreload())) return;
  window.preloadRoomFeature?.(view).catch(() => {});
}

document.addEventListener('pointerover', (event) => preloadRoomFeatureFromIntent(event), true);
document.addEventListener('focusin', (event) => preloadRoomFeatureFromIntent(event), true);
document.addEventListener('pointerdown', (event) => preloadRoomFeatureFromIntent(event, { explicit: true }), true);

// Version the preference so stale pre-fix collapsed state cannot hide every
// room label after the responsive room-row layout changes.
const ROOM_COLLAPSE_STORAGE_KEY = 'minimalist.roomsCollapsed.v2';
const roomCollapseViewport = window.matchMedia?.('(min-width: 769px)');
let roomCollapseTimer = null;

function supportsCollapsedRoomRail() {
  return roomCollapseViewport?.matches !== false;
}

function prefersReducedRoomMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
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

  const requestedCollapsed = Boolean(nextCollapsed);
  const collapsed = requestedCollapsed && supportsCollapsedRoomRail();

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
      window.localStorage?.setItem(ROOM_COLLAPSE_STORAGE_KEY, requestedCollapsed ? 'true' : 'false');
    } catch {
      // Storage can be unavailable in private browsing; the UI should still animate.
    }
  }

  if (animate && !prefersReducedRoomMotion()) {
    roomCollapseTimer = window.setTimeout(() => {
      wrapper.classList.remove('room-collapse-animating', 'rooms-expanding', 'rooms-collapsing');
      roomCollapseTimer = null;
    }, 260);
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
  } catch {
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

if (roomCollapseViewport?.addEventListener) {
  roomCollapseViewport.addEventListener('change', hydrateRoomCollapsePreference);
} else if (roomCollapseViewport?.addListener) {
  roomCollapseViewport.addListener(hydrateRoomCollapsePreference);
}

document.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  if (!target) return;

  if (target.closest('#mobile-back-to-rooms')) {
    document.getElementById('desktop-room-sidebar')?.classList.add('open');
  }

  if (target.closest('.room-item')) {
    const roomSearch = document.getElementById('room-search-input');
    if (roomSearch) roomSearch.value = '';
  }

  const updateTab = target.closest('.update-tab');
  if (updateTab && UPDATE_PANELS[updateTab.id]) {
    event.preventDefault();
    activateUpdatesTab(updateTab.id);
  }
});

document.addEventListener('input', (event) => {
  const target = eventTargetElement(event);
  if (!target) return;

  if (target.id === 'pm-search-input') {
    const query = target.value.toLowerCase();
    document.querySelectorAll('#pm-messages li').forEach((msg) => {
      const text = msg.textContent.toLowerCase();
      msg.style.display = text.includes(query) ? 'list-item' : 'none';
    });
  }

});

document.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  if (!target) return;

  const profilePopup = document.getElementById('user-profile-popup');
  if (profilePopup && !profilePopup.classList.contains('hidden')) {
    if (
      !target.closest('#user-profile-popup')
      && !target.closest('.msg-avatar')
      && !target.closest('.msg-name')
      && !target.closest('.avatar-wrapper')
      && !target.closest('.contact-icon-btn')
      && !target.closest('#preview-profile-btn')
    ) {
      if (typeof window.closeUserProfilePopup === 'function') window.closeUserProfilePopup();
      else {
        profilePopup.classList.add('hidden');
        const settings = document.getElementById('settings-modal');
        if (!settings || settings.classList.contains('hidden')) {
          document.getElementById('modal-overlay')?.classList.add('hidden');
        }
      }
    }
  }

  if (target.id === 'modal-overlay') {
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
  const target = eventTargetElement(event);
  if (!target) return;

  const isRooms = target.closest('#open-rooms-btn-mobile');
  const isContacts = target.closest('#open-contacts-btn') || target.closest('#open-contacts-btn-mobile');
  const isPersonalAgent = target.closest('#open-personal-agent-btn') || target.closest('#open-personal-agent-btn-mobile');
  const personalAgentSurface = isPersonalAgent?.id === 'open-personal-agent-btn-mobile' ? 'mobile' : 'desktop';
  const isVault = target.closest('#open-vault-btn') || target.closest('#open-vault-btn-mobile');
  const isUpdates = target.closest('#open-updates-btn-desktop') || target.closest('#open-updates-btn-mobile');
  const isBookmarks = target.closest('#open-bookmarks-btn');
  const isSettings = target.closest('#open-settings-btn') || target.closest('#open-settings-btn-mobile');
  const isMore = target.closest('#open-more-btn-mobile');
  const isMoreClose = target.closest('#close-mobile-dock-more');
  const isMobileSearch = target.closest('#open-search-btn-mobile');

  if (isMoreClose) {
    event.stopImmediatePropagation();
    event.preventDefault();
    setMobileDockMoreOpen(false, { restoreFocus: true });
    return;
  }

  if (isMore) {
    event.stopImmediatePropagation();
    event.preventDefault();
    const menu = document.getElementById('mobile-dock-more-menu');
    const wasOpen = Boolean(menu && !menu.classList.contains('hidden'));
    if (wasOpen) setMobileDockMoreOpen(false, { restoreFocus: true });
    else {
      // More is an overlay, not a destination change. Keep the current room
      // view or app surface in place until the user chooses a utility.
      setMobileDockMoreOpen(true, { focusFirst: true });
    }
    return;
  }

  if (isMobileSearch) {
    closeFloatingUI({ keep: 'search-modal' });
    return;
  }

  const moreMenu = document.getElementById('mobile-dock-more-menu');
  if (moreMenu && !moreMenu.classList.contains('hidden') && !target.closest('#mobile-dock-more-menu')) {
    setMobileDockMoreOpen(false);
  }

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

  setMobileDockMoreOpen(false);

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
    // Reveal the drawer immediately, even if its lazy service is still warming.
    // openContactsPanel is idempotent and hydrates cached rows/subscriptions once ready.
    contactsPanel?.classList.add('open');
    if (window.openContactsPanel) window.openContactsPanel();
    else if (window.toggleContacts) window.toggleContacts();
  }

  if (isPersonalAgent && !wasPersonalAgentOpen) {
    if (window.openPersonalAgent) window.openPersonalAgent({ surface: personalAgentSurface });
  }

  if (isVault && !wasVaultOpen) {
    vaultLastFocus = isVault.id === 'open-vault-btn-mobile'
      ? document.getElementById('open-more-btn-mobile')
      : isVault;
    if (window.openVault) {
      window.openVault();
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        document.getElementById('close-vault-btn')?.focus({ preventScroll: true });
      }));
    }
  }

  if (isUpdates && !wasUpdatesOpen && updatesPanel) {
    window.openUpdatesPanel?.({ closeOthers: false, opener: isUpdates });
  }

  if (isBookmarks && !wasBookmarksOpen) {
    window.openBookmarks?.();
  }

  if (isSettings && !wasSettingsOpen) {
    if (isSettings.id === 'open-settings-btn-mobile') {
      document.getElementById('open-more-btn-mobile')?.focus({ preventScroll: true });
    }
    if (window.openSettings) window.openSettings();
  }
}, true);

document.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  if (!target) return;

  if (target.closest('#close-personal-agent-btn')) {
    if (typeof window.closePersonalAgent === 'function') window.closePersonalAgent();
    else document.getElementById('personal-ai-agent-panel')?.classList.remove('open');
  }

  if (target.closest('#close-vault-btn')) {
    closeVaultPanel({ restoreFocus: true });
  }

  if (target.closest('#toggle-rooms-collapse-btn')) {
    const wrapper = document.getElementById('chat-wrapper');
    setRoomsCollapsed(!wrapper?.classList.contains('rooms-collapsed'));
  }
});

document.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  if (!target) return;

  const samePageChatLink = target.closest('a[href="/chat"]');
  if (samePageChatLink && window.location.pathname.includes('/chat')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeFloatingUI();
    activateRoomView('chat');
    scrollMessagesToLatest(2);
    return;
  }
}, true);

function setRoomSearchOpen(open, { focus = true } = {}) {
  const searchInput = document.getElementById('room-search-input');
  const toggle = document.getElementById('toggle-room-search-btn');
  if (!searchInput) return false;

  searchInput.classList.toggle('open', open);
  searchInput.setAttribute('aria-hidden', open ? 'false' : 'true');
  searchInput.tabIndex = open ? 0 : -1;
  toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');

  if (open) {
    if (focus) searchInput.focus();
    return true;
  }

  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  if (focus) toggle?.focus();
  return true;
}

window.setRoomSearchOpen = setRoomSearchOpen;

document.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  if (!target?.closest('#toggle-room-search-btn')) return;

  const searchInput = document.getElementById('room-search-input');
  if (!searchInput) return;
  setRoomSearchOpen(!searchInput.classList.contains('open'));
});

document.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  if (!target) return;

  const tabBtn = target.closest('.room-tab');
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

document.addEventListener('keydown', (event) => {
  const roomNameTrigger = event.target?.closest?.('#room-name-wrapper');
  if (roomNameTrigger && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    roomNameTrigger.click();
    window.requestAnimationFrame(syncRoomDropdownAccessibility);
    return;
  }

  const updatesTab = event.target?.closest?.('.update-tab');
  if (updatesTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const tabs = Object.keys(UPDATE_PANELS)
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const currentIndex = Math.max(0, tabs.indexOf(updatesTab));
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    activateUpdatesTab(tabs[nextIndex]?.id, { focus: true });
    return;
  }

  const moreMenuItem = event.target?.closest?.('#mobile-dock-more-menu [role="menuitem"]');
  if (moreMenuItem && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    const items = [...document.querySelectorAll('#mobile-dock-more-menu [role="menuitem"]:not(:disabled)')]
      .filter((item) => item.offsetParent !== null);
    const currentIndex = Math.max(0, items.indexOf(moreMenuItem));
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus();
    return;
  }

  if (event.key !== 'Escape' || event.defaultPrevented) return;

  const moreMenu = document.getElementById('mobile-dock-more-menu');
  if (isVisibleElement(moreMenu)) {
    event.preventDefault();
    setMobileDockMoreOpen(false, { restoreFocus: true });
    return;
  }

  const deleteAccountModal = document.getElementById('delete-account-modal');
  if (isVisibleElement(deleteAccountModal)) {
    event.preventDefault();
    document.getElementById('delete-cancel-btn')?.click();
    window.requestAnimationFrame(() => document.getElementById('delete-account-btn')?.focus());
    return;
  }

  const profilePopup = document.getElementById('user-profile-popup');
  if (isVisibleElement(profilePopup)) {
    event.preventDefault();
    if (typeof window.closeUserProfilePopup === 'function') window.closeUserProfilePopup();
    else profilePopup?.classList.add('hidden');
    return;
  }

  const settingsModal = document.getElementById('settings-modal');
  if (isVisibleElement(settingsModal)) {
    event.preventDefault();
    const settingsPreview = document.getElementById('settings-profile-preview');
    if (isVisibleElement(settingsPreview) && typeof window.closeSettingsCardPreview === 'function') {
      window.closeSettingsCardPreview();
    } else if (typeof window.closeSettingsModal === 'function') {
      window.closeSettingsModal({ restoreFocus: true });
    } else {
      settingsModal.classList.add('hidden');
    }
    return;
  }

  const roomSidebar = document.getElementById('desktop-room-sidebar');
  const menuIds = [
    'room-settings-dropdown',
    'room-add-page-menu',
    'profile-more-dropdown',
    'custom-context-menu',
    'emoji-picker',
  ];
  const floatingIds = [
    'contacts-panel',
    'updates-panel',
    'personal-ai-agent-panel',
    'vault-panel',
    'settings-modal',
    'room-settings-modal',
    'room-action-modal',
    'room-invite-modal',
    'leave-room-modal',
    'delete-room-modal',
    'mute-user-modal',
    'admin-dashboard-modal',
    'search-modal',
  ];

  const openMenuId = menuIds.find((id) => isVisibleElement(document.getElementById(id)));
  if (openMenuId) {
    if (openMenuId === 'emoji-picker' && typeof window.closeEmojiPicker === 'function') {
      window.closeEmojiPicker({ restoreFocus: true });
    } else {
      document.getElementById(openMenuId)?.classList.add('hidden');
    }
    return;
  }

  if (floatingIds.some((id) => isVisibleElement(document.getElementById(id)))) {
    closeFloatingUI({ restoreFocus: true });
    return;
  }

  if (roomSidebar?.classList.contains('open')) {
    roomSidebar.classList.remove('open');
  }
});

window.onRoomChanged = function onRoomChanged() {
  const defaultView = window.isSimpleFeatureMode?.() ? 'chat' : window.activeRoomId === 'global' ? 'chat' : 'home';

  const activeTab = Array.from(document.querySelectorAll('.room-tab')).find((tab) => tab.getAttribute('data-target') === defaultView);
  syncRoomViewAccessibility(defaultView, activeTab);
  syncRoomChannelBar(defaultView);

  if (window.renderRoomPages) window.renderRoomPages();
  const roomScopedFeatureLoaders = {
    home: window.loadRoomHome,
    docs: window.loadRoomDocs,
    whiteboard: window.loadRoomWhiteboard,
    tasks: window.loadRoomTasks,
    events: window.loadRoomEvents,
    calendar: window.loadRoomCalendar,
    ai: window.loadRoomAI,
  };
  const defaultLoader = roomScopedFeatureLoaders[defaultView];
  if (typeof defaultLoader === 'function') defaultLoader();
  // Calls are excluded here so changing rooms cannot interrupt an active or
  // minimized call. Other hidden features rescope lazily when selected so room
  // switching stays constant-cost no matter how many tabs were opened before.
};
