const featureModules = new Map();
let searchMounted = false;
let searchMountPromise = null;

function importOnce(key, importer) {
  if (!featureModules.has(key)) {
    featureModules.set(
      key,
      importer().catch((error) => {
        featureModules.delete(key);
        throw error;
      })
    );
  }
  return featureModules.get(key);
}

function setFeatureLoading(view, loading = true) {
  const host = document.getElementById(`room-view-${view}`);
  if (!host || host.dataset.featureMounted === 'true') return;
  host.classList.toggle('is-loading-feature', loading);
  if (loading && !host.querySelector('.room-view-loading')) {
    host.replaceChildren(Object.assign(document.createElement('div'), {
      className: 'room-view-loading',
      textContent: 'Loading...',
    }));
  }
}

function markFeatureMounted(view) {
  const host = document.getElementById(`room-view-${view}`);
  if (!host) return;
  host.dataset.featureMounted = 'true';
  host.classList.remove('is-loading-feature');
}

function loadFeatureStyles() {
  window.__minimalistLoadFeatureStyles?.();
}

function mountSearchOnce({ initialOpen = false } = {}) {
  if (searchMounted) return Promise.resolve();
  if (!searchMountPromise) {
    searchMountPromise = import('../search/mountSearch.js')
      .then(({ mountSearch }) => {
        mountSearch({ getAvatarUrl: window.getAvatarUrl, initialOpen });
        searchMounted = true;
      })
      .catch((error) => {
        searchMountPromise = null;
        throw error;
      });
  }
  return searchMountPromise;
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('#open-search-btn') || searchMounted) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  mountSearchOnce({ initialOpen: true }).catch((error) => {
    window.showToast?.(`Search failed to load: ${error.message || error}`, true);
  });
}, true);

async function mountDeferredRoomView(view, importer, mountName, propsFactory) {
  const context = currentRoomContext();
  if (!context) return;
  loadFeatureStyles();
  setFeatureLoading(view, true);
  try {
    const module = await importOnce(view, importer);
    module[mountName](propsFactory(context));
    markFeatureMounted(view);
  } catch (error) {
    setFeatureLoading(view, false);
    window.showToast?.(`${view} failed to load: ${error.message || error}`, true);
    throw error;
  }
}

function currentRoomContext() {
  if (!window.currentUser || !window.activeRoomId) return null;
  return {
    roomId: window.activeRoomId,
    user: {
      uid: window.currentUser.uid,
      displayName: window.userProfileName || 'Anonymous',
      email: window.currentUser.email || '',
      photoUrl: window.userPhotoUrl || '',
    },
    adminUid: window.MY_ADMIN_UID,
  };
}

window.loadRoomHome = function loadRoomHome() {
  return mountDeferredRoomView('home', () => import('../room-home/mountRoomHome.js'), 'mountRoomHome', (context) => ({
    roomId: context.roomId,
    user: { uid: context.user.uid },
    adminUid: context.adminUid,
    getAvatarUrl: window.getAvatarUrl,
  }));
};

window.loadRoomDocs = function loadRoomDocs() {
  return mountDeferredRoomView('docs', () => import('../docs/mountDocs.js'), 'mountDocs', (context) => ({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
      email: context.user.email,
    },
  }));
};

window.loadRoomWhiteboard = function loadRoomWhiteboard() {
  return mountDeferredRoomView('whiteboard', () => import('../whiteboard/mountWhiteboard.js'), 'mountWhiteboard', (context) => ({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
    },
  }));
};

window.loadRoomTasks = function loadRoomTasks() {
  return mountDeferredRoomView('tasks', () => import('../tasks/mountTasks.js'), 'mountTasks', (context) => ({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
    },
  }));
};

window.loadRoomEvents = function loadRoomEvents() {
  return mountDeferredRoomView('events', () => import('../events/mountEvents.js'), 'mountEvents', (context) => ({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
      email: context.user.email,
    },
    adminUid: context.adminUid,
  }));
};

window.loadRoomCalendar = function loadRoomCalendar() {
  return mountDeferredRoomView('calendar', () => import('../calendar/mountCalendar.js'), 'mountCalendar', (context) => ({
    roomId: context.roomId,
    user: { uid: context.user.uid },
    adminUid: context.adminUid,
    gcalClientId: window.GCAL_CLIENT_ID || '',
    aiCalendarEndpoint: window.AI_CALENDAR_ENDPOINT || '',
  }));
};

window.loadRoomAI = function loadRoomAI() {
  return mountDeferredRoomView('ai', () => import('../ai/mountAI.js'), 'mountAI', (context) => ({
    roomId: context.roomId,
    aiChatEndpoint: window.AI_CHAT_ENDPOINT || '',
  }));
};

window.loadRoomCalls = function loadRoomCalls() {
  return mountDeferredRoomView('calls', () => import('../calls/mountCalls.js'), 'mountCalls', (context) => ({
    roomId: context.roomId,
    adminUid: context.adminUid,
    user: context.user,
  }));
};

window.renderRoomPages = async function renderRoomPages() {
  if (!window.activeRoomId) return;
  loadFeatureStyles();
  const { mountRoomPages } = await importOnce('room-pages', () => import('../room-pages/mountRoomPages.js'));
  mountRoomPages({
    roomId: window.activeRoomId,
    userId: window.currentUser?.uid || null,
    adminUid: window.MY_ADMIN_UID,
  });
};

window.openPersonalAgent = async function openPersonalAgent() {
  if (!window.currentUser) return;
  loadFeatureStyles();
  document.getElementById('contacts-panel')?.classList.remove('open');
  document.getElementById('updates-panel')?.classList.remove('open');
  document.getElementById('vault-panel')?.classList.remove('open');
  const panel = document.getElementById('personal-ai-agent-panel');
  if (!panel) return;
  panel.classList.add('open');
  const { mountPersonalAgent } = await importOnce('personal-agent', () => import('../ai/mountPersonalAgent.js'));
  mountPersonalAgent({
    roomId: window.activeRoomId || 'global',
    personalAiAgentEndpoint: window.PERSONAL_AI_AGENT_ENDPOINT || '',
  });
};

window.openVault = async function openVault(initialView = 'all') {
  if (!window.currentUser) return;
  loadFeatureStyles();
  document.getElementById('contacts-panel')?.classList.remove('open');
  document.getElementById('updates-panel')?.classList.remove('open');
  document.getElementById('personal-ai-agent-panel')?.classList.remove('open');
  document.getElementById('bookmarks-panel')?.classList.add('hidden');
  const panel = document.getElementById('vault-panel');
  if (!panel) return;
  panel.dataset.vaultView = initialView || 'all';
  panel.classList.add('open');
  window.dispatchEvent(new CustomEvent('minimalist:vault-open', { detail: { view: initialView || 'all' } }));
  const { mountVault } = await importOnce('vault', () => import('../vault/mountVault.js'));
  mountVault({
    userId: window.currentUser.uid,
    userName: window.userProfileName || window.currentUser.displayName || 'You',
    initialView: initialView || 'all',
    bookmarks: window.__bookmarkIds || {},
  });
};
