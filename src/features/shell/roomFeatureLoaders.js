import { createFeatureMountCoordinator } from './featureMountCoordinator.js';
import {
  loadPersonalAgentPreferences,
  PERSONAL_AGENT_DISABLED_BODY_CLASSES,
  resolvePersonalAgentSurface,
} from '../ai/personalAgentPreference.js';

const featureModules = new Map();
const roomMountCoordinator = createFeatureMountCoordinator();
const panelMountCoordinator = createFeatureMountCoordinator();
let searchMounted = false;
let searchMountPromise = null;
let searchShouldOpenOnMount = false;
let vaultPrewarmPromise = null;
let personalAgentLastFocus = null;

function eventTargetElement(event) {
  const target = event.target;
  if (target instanceof Element) return target;
  return target?.parentElement || null;
}

function closeContactsPanelIfOpen() {
  const panel = document.getElementById('contacts-panel');
  if (!panel?.classList.contains('open')) return;
  if (typeof window.closeContactsPanel === 'function') window.closeContactsPanel();
  else panel.classList.remove('open');
}

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
  host.classList.remove('has-ai-load-error');
  delete host.dataset.featureError;
  host.classList.toggle('is-loading-feature', loading);
  host.setAttribute('aria-busy', loading ? 'true' : 'false');
  if (!loading) {
    host.querySelector('.room-view-loading')?.remove();
    return;
  }
  if (loading && !host.querySelector('.room-view-loading')) {
    const label = Object.assign(document.createElement('span'), { textContent: 'Loading...' });
    const loadingNode = Object.assign(document.createElement('div'), {
      className: 'room-view-loading',
    });
    loadingNode.setAttribute('role', 'status');
    loadingNode.setAttribute('aria-live', 'polite');
    loadingNode.append(label);
    host.replaceChildren(loadingNode);
  }
}

function markFeatureMounted(view) {
  const host = document.getElementById(`room-view-${view}`);
  if (!host) return;
  host.dataset.featureMounted = 'true';
  host.classList.remove('has-ai-load-error');
  delete host.dataset.featureError;
  host.classList.remove('is-loading-feature');
  host.setAttribute('aria-busy', 'false');
}

function aiFailureDetails(error) {
  const message = String(error?.message || error || '');
  const match = message.match(/https?:\/\/[^\s)]+/i);
  if (!match) return 'AI_MODULE_LOAD_FAILED';
  try {
    const moduleUrl = new URL(match[0].replace(/[.,;]+$/, ''), window.location.href);
    moduleUrl.search = '';
    moduleUrl.hash = '';
    return `AI_MODULE_LOAD_FAILED\nModule: ${moduleUrl.toString()}`;
  } catch {
    return 'AI_MODULE_LOAD_FAILED';
  }
}

function makeAiRecoveryStatus(label, value, tone) {
  const row = Object.assign(document.createElement('div'), { className: 'room-ai-recovery-status' });
  const dot = Object.assign(document.createElement('span'), { className: `room-ai-recovery-dot is-${tone}` });
  dot.setAttribute('aria-hidden', 'true');
  row.append(
    dot,
    Object.assign(document.createElement('span'), { textContent: label }),
    Object.assign(document.createElement('strong'), { textContent: value })
  );
  return row;
}

function makeAiRecoveryNode(error) {
  const recovery = Object.assign(document.createElement('section'), {
    className: 'room-ai-recovery',
  });
  recovery.setAttribute('aria-labelledby', 'room-ai-recovery-title');

  const panel = Object.assign(document.createElement('div'), { className: 'room-ai-recovery-panel' });
  const visual = Object.assign(document.createElement('div'), { className: 'room-ai-recovery-visual' });
  visual.setAttribute('aria-hidden', 'true');
  const mascot = Object.assign(document.createElement('div'), { className: 'mascot-blip' });
  mascot.append(
    Object.assign(document.createElement('div'), { className: 'blip-eye left' }),
    Object.assign(document.createElement('div'), { className: 'blip-eye right' })
  );
  const orbit = Object.assign(document.createElement('span'), { className: 'room-ai-recovery-orbit' });
  visual.append(orbit, mascot);

  const badge = Object.assign(document.createElement('span'), {
    className: 'room-ai-recovery-badge',
    textContent: 'AI workspace interrupted',
  });
  const heading = Object.assign(document.createElement('h2'), {
    id: 'room-ai-recovery-title',
    textContent: 'AI workspace needs a refresh',
  });
  const copy = Object.assign(document.createElement('p'), {
    textContent: 'Minimalist is still ready, but the AI interface did not finish loading. This can happen after the local server restarts or an old browser chunk is cached.',
  });
  const liveAlert = Object.assign(document.createElement('span'), {
    className: 'room-ai-recovery-live',
    textContent: 'The AI workspace did not load. Reload AI or return to Chat.',
  });
  liveAlert.setAttribute('role', 'alert');

  const statusList = Object.assign(document.createElement('div'), {
    className: 'room-ai-recovery-statuses',
  });
  statusList.setAttribute('aria-label', 'AI workspace status');
  statusList.append(
    makeAiRecoveryStatus('App', 'Ready', 'ready'),
    makeAiRecoveryStatus('AI workspace', 'Interrupted', 'error'),
    makeAiRecoveryStatus('Gateway', 'Not checked', 'neutral')
  );

  const actions = Object.assign(document.createElement('div'), { className: 'room-ai-recovery-actions' });
  const reloadButton = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'room-ai-recovery-primary',
  });
  const reloadIcon = Object.assign(document.createElement('i'), { className: 'ph-bold ph-arrows-clockwise' });
  reloadIcon.setAttribute('aria-hidden', 'true');
  reloadButton.append(reloadIcon, document.createTextNode('Reload AI'));
  reloadButton.addEventListener('click', () => {
    reloadButton.disabled = true;
    reloadButton.lastChild.textContent = 'Reloading…';
    window.location.reload();
  });

  const chatButton = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'room-ai-recovery-secondary',
    textContent: 'Back to Chat',
  });
  chatButton.addEventListener('click', () => {
    if (typeof window.activateRoomView === 'function') window.activateRoomView('chat');
    else document.getElementById('room-tab-chat')?.click();
    window.setTimeout(() => document.getElementById('message-input')?.focus(), 0);
  });
  actions.append(reloadButton, chatButton);

  const assurance = Object.assign(document.createElement('p'), {
    className: 'room-ai-recovery-assurance',
    textContent: 'Your room and messages are untouched.',
  });

  const details = Object.assign(document.createElement('details'), { className: 'room-ai-recovery-details' });
  const summary = Object.assign(document.createElement('summary'), { textContent: 'Technical details' });
  const code = Object.assign(document.createElement('code'), { textContent: aiFailureDetails(error) });
  details.append(summary, code);

  panel.append(visual, badge, heading, copy, liveAlert, statusList, actions, assurance, details);
  recovery.append(panel);
  return recovery;
}

function setFeatureError(view, error) {
  const host = document.getElementById(`room-view-${view}`);
  if (!host || host.dataset.featureMounted === 'true') return;
  host.classList.remove('is-loading-feature');
  host.setAttribute('aria-busy', 'false');
  if (view === 'ai') {
    host.classList.add('has-ai-load-error');
    host.dataset.featureError = 'AI_MODULE_LOAD_FAILED';
    host.replaceChildren(makeAiRecoveryNode(error));
    return;
  }
  const message = `${view} failed to load: ${error?.message || error || 'Unknown error'}`;
  const errorNode = Object.assign(document.createElement('div'), {
    className: 'room-view-loading room-view-error',
    role: 'alert',
    textContent: message,
  });
  host.replaceChildren(errorNode);
}

function panelLoadingNode(label) {
  const node = Object.assign(document.createElement('div'), {
    className: 'feature-panel-loading',
  });
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  const spinner = Object.assign(document.createElement('span'), {
    className: 'feature-panel-spinner',
  });
  spinner.setAttribute('aria-hidden', 'true');
  const copy = Object.assign(document.createElement('span'), { textContent: label });
  node.append(spinner, copy);
  return node;
}

function setPanelLoading(rootId, label, loading = true) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const panel = root.closest('#personal-ai-agent-panel, #vault-panel');
  panel?.setAttribute('aria-busy', loading ? 'true' : 'false');
  root.classList.toggle('is-loading-feature', loading);
  if (loading && !root.hasChildNodes()) {
    root.replaceChildren(panelLoadingNode(label));
  }
  if (!loading) {
    root.querySelector(':scope > .feature-panel-loading')?.remove();
  }
}

function setPanelError(rootId, label, error) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const panel = root.closest('#personal-ai-agent-panel, #vault-panel');
  panel?.setAttribute('aria-busy', 'false');
  root.classList.remove('is-loading-feature');
  const message = `${label}: ${error?.message || error || 'Unknown error'}`;
  const errorNode = Object.assign(document.createElement('div'), {
    className: 'feature-panel-loading feature-panel-error',
    role: 'alert',
    textContent: message,
  });
  root.replaceChildren(errorNode);
}

function loadFeatureStyles() {
  window.__minimalistLoadFeatureStyles?.();
}

function aiConfigFromWindow() {
  return {
    baseUrl: window.OLLAMA_BASE_URL || '',
    fastModel: window.OLLAMA_FAST_MODEL || window.OLLAMA_MODEL || '',
    smartModel: window.OLLAMA_SMART_MODEL || '',
    visionModel: window.OLLAMA_VISION_MODEL || '',
    provider: window.AI_PROVIDER || 'local',
    gatewayEndpoint: window.AI_GATEWAY_ENDPOINT || window.AI_CHAT_ENDPOINT || '',
    profileEndpoint: window.AI_PROFILE_ENDPOINT || '',
    calendarEndpoint: window.AI_CALENDAR_ENDPOINT || '',
    flags: window.MINIMALIST_FLAGS || {},
  };
}

function searchMountedInCurrentHost() {
  const host = document.getElementById('search-modal');
  return Boolean(searchMounted && host?.dataset.featureMounted === 'true');
}

function mountSearchOnce({ initialOpen = false } = {}) {
  if (searchMountedInCurrentHost()) return Promise.resolve();
  if (searchMounted) {
    searchMounted = false;
    searchMountPromise = null;
  }
  if (initialOpen) searchShouldOpenOnMount = true;
  if (!searchMountPromise) {
    searchMountPromise = import('../search/mountSearch.js')
      .then(({ mountSearch }) => {
        mountSearch({ getAvatarUrl: window.getAvatarUrl, initialOpen: searchShouldOpenOnMount || initialOpen });
        const host = document.getElementById('search-modal');
        if (host) host.dataset.featureMounted = 'true';
        searchMounted = true;
        searchShouldOpenOnMount = false;
      })
      .catch((error) => {
        searchMountPromise = null;
        throw error;
      });
  }
  return searchMountPromise;
}

document.addEventListener('click', (event) => {
  const target = eventTargetElement(event);
  if (!target?.closest('#open-search-btn') || searchMountedInCurrentHost()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  mountSearchOnce({ initialOpen: true }).catch((error) => {
    window.showToast?.(`Search failed to load: ${error.message || error}`, true);
  });
}, true);

document.addEventListener('pointerenter', (event) => {
  const target = eventTargetElement(event);
  if (target?.closest('#open-search-btn')) mountSearchOnce().catch(() => {});
}, true);

document.addEventListener('touchstart', (event) => {
  const target = eventTargetElement(event);
  if (target?.closest('#open-search-btn')) mountSearchOnce().catch(() => {});
}, { passive: true, capture: true });

document.addEventListener('focusin', (event) => {
  const target = eventTargetElement(event);
  if (target?.closest('#open-search-btn')) mountSearchOnce().catch(() => {});
}, true);

async function mountDeferredRoomView(
  view,
  importer,
  mountName,
  propsFactory,
  contextKeyFactory = (context) => `${context.user.uid}:${context.roomId}`,
) {
  const context = currentRoomContext();
  if (!context) return;
  const props = propsFactory(context);
  const contextKey = String(contextKeyFactory(context));
  const host = document.getElementById(`room-view-${view}`);
  const scheduled = roomMountCoordinator.schedule(
    view,
    contextKey,
    () => importOnce(view, importer),
    (module) => {
      module[mountName](props);
      markFeatureMounted(view);
    },
    {
      cacheIsValid: () => host?.isConnected === true
        && host.dataset.featureMounted === 'true',
      isRelevant: () => {
        const latestContext = currentRoomContext();
        return Boolean(latestContext && String(contextKeyFactory(latestContext)) === contextKey);
      },
    },
  );

  if (scheduled.status === 'started') {
    loadFeatureStyles();
    setFeatureLoading(view, true);
  }
  try {
    return await scheduled.promise;
  } catch (error) {
    setFeatureError(view, error);
    window.showToast?.(view === 'ai' ? 'AI workspace needs a refresh.' : `${view} failed to load: ${error.message || error}`, true);
    throw error;
  }
}

function currentRoomContext() {
  if (!window.currentUser || !window.activeRoomId) return null;
  return {
    roomId: window.activeRoomId,
    roomName: document.getElementById('active-room-name-display')?.textContent?.trim()
      || (window.activeRoomId === 'global' ? 'Global Chat' : 'this room'),
    user: {
      uid: window.currentUser.uid,
      displayName: window.userProfileName || 'Anonymous',
      email: window.currentUser.email || '',
      photoUrl: window.userPhotoUrl || '',
    },
    adminUid: window.MY_ADMIN_UID,
  };
}

const roomFeatureImporters = Object.freeze({
  home: () => import('../room-home/mountRoomHome.js'),
  docs: () => import('../docs/mountDocs.js'),
  whiteboard: () => import('../whiteboard/mountWhiteboard.js'),
  tasks: () => import('../tasks/mountTasks.js'),
  events: () => import('../events/mountEvents.js'),
  calendar: () => import('../calendar/mountCalendar.js'),
  ai: () => import('../ai/mountAI.js'),
  calls: () => import('../calls/mountCalls.js'),
});

window.preloadRoomFeature = function preloadRoomFeature(view) {
  const importer = roomFeatureImporters[view];
  if (!importer) return Promise.resolve(false);
  return importOnce(view, importer).then(() => true);
};

window.loadRoomHome = function loadRoomHome() {
  return mountDeferredRoomView('home', roomFeatureImporters.home, 'mountRoomHome', (context) => ({
    roomId: context.roomId,
    user: { uid: context.user.uid },
    adminUid: context.adminUid,
    getAvatarUrl: window.getAvatarUrl,
  }));
};

window.loadRoomDocs = function loadRoomDocs() {
  return mountDeferredRoomView('docs', roomFeatureImporters.docs, 'mountDocs', (context) => ({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
      email: context.user.email,
      photoUrl: context.user.photoUrl,
    },
  }));
};

window.loadRoomWhiteboard = function loadRoomWhiteboard() {
  return mountDeferredRoomView('whiteboard', roomFeatureImporters.whiteboard, 'mountWhiteboard', (context) => ({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
    },
  }));
};

window.loadRoomTasks = function loadRoomTasks() {
  return mountDeferredRoomView('tasks', roomFeatureImporters.tasks, 'mountTasks', (context) => ({
    roomId: context.roomId,
    user: {
      uid: context.user.uid,
      displayName: context.user.displayName,
    },
  }));
};

window.loadRoomEvents = function loadRoomEvents() {
  return mountDeferredRoomView('events', roomFeatureImporters.events, 'mountEvents', (context) => ({
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
  return mountDeferredRoomView('calendar', roomFeatureImporters.calendar, 'mountCalendar', (context) => ({
    roomId: context.roomId,
    user: { uid: context.user.uid },
    adminUid: context.adminUid,
    gcalClientId: window.GCAL_CLIENT_ID || '',
    localAiConfig: aiConfigFromWindow(),
  }));
};

window.loadRoomAI = function loadRoomAI() {
  return mountDeferredRoomView('ai', roomFeatureImporters.ai, 'mountAI', (context) => ({
    roomId: context.roomId,
    roomName: context.roomName,
    channelId: window.activeChannelId || 'general',
    localAiConfig: aiConfigFromWindow(),
  }), (context) => `${context.user.uid}:${context.roomId}:${window.activeChannelId || 'general'}`);
};

window.loadRoomCalls = function loadRoomCalls() {
  return mountDeferredRoomView('calls', roomFeatureImporters.calls, 'mountCalls', (context) => ({
    roomId: context.roomId,
    adminUid: context.adminUid,
    user: context.user,
    activeChannelId: window.activeChannelId || 'general',
    enableCallChannelsV2: window.CALLS_V2_ENABLED === true || window.MINIMALIST_FLAGS?.callsV2 === true,
  }), (context) => `${context.user.uid}:${context.roomId}:${window.activeChannelId || 'general'}:${window.CALLS_V2_ENABLED === true || window.MINIMALIST_FLAGS?.callsV2 === true ? 'v2' : 'v1'}`);
};

window.renderRoomPages = async function renderRoomPages() {
  const roomId = window.activeRoomId;
  const userId = window.currentUser?.uid || null;
  if (!roomId) return;
  const host = document.getElementById('room-pages-dynamic');
  const contextKey = `${userId || 'anonymous'}:${roomId}`;
  const scheduled = roomMountCoordinator.schedule(
    'room-pages',
    contextKey,
    () => importOnce('room-pages', () => import('../room-pages/mountRoomPages.js')),
    ({ mountRoomPages }) => {
      mountRoomPages({ roomId, userId, adminUid: window.MY_ADMIN_UID });
      if (host) host.dataset.featureMounted = 'true';
    },
    {
      cacheIsValid: () => host?.isConnected === true && host.dataset.featureMounted === 'true',
      isRelevant: () => window.activeRoomId === roomId && (window.currentUser?.uid || null) === userId,
    },
  );
  if (scheduled.status === 'started') loadFeatureStyles();
  return scheduled.promise;
};

function personalAgentSurfaceIsEnabled(surface, preferences = loadPersonalAgentPreferences()) {
  return preferences[surface] !== false
    && !document.body.classList.contains(PERSONAL_AGENT_DISABLED_BODY_CLASSES[surface]);
}

function personalAgentTrigger(surface) {
  const id = surface === 'mobile' ? 'open-personal-agent-btn-mobile' : 'open-personal-agent-btn';
  return document.getElementById(id);
}

function focusPersonalAgentPanel(panel) {
  window.requestAnimationFrame(() => {
    if (!panel?.classList.contains('open')) return;
    const target = panel.querySelector('#close-personal-agent-btn, [data-pa-initial-focus="true"]:not(:disabled), button:not(:disabled), input:not(:disabled)');
    target?.focus?.({ preventScroll: true });
  });
}

function syncPersonalAgentOpenState(open, surface = null) {
  const panel = document.getElementById('personal-ai-agent-panel');
  panel?.classList.toggle('open', open);
  panel?.setAttribute('aria-hidden', open ? 'false' : 'true');
  panel?.setAttribute('aria-modal', 'false');
  if (panel) {
    if (open && surface) panel.dataset.personalAgentSurface = surface;
    else if (!open) delete panel.dataset.personalAgentSurface;
  }
  ['open-personal-agent-btn', 'open-personal-agent-btn-mobile'].forEach((id) => {
    const triggerSurface = id === 'open-personal-agent-btn-mobile' ? 'mobile' : 'desktop';
    document.getElementById(id)?.setAttribute(
      'aria-expanded',
      open && triggerSurface === surface ? 'true' : 'false',
    );
  });
}

window.closePersonalAgent = function closePersonalAgent({ restoreFocus = true, unmount = false } = {}) {
  const panel = document.getElementById('personal-ai-agent-panel');
  const wasOpen = panel?.classList.contains('open') === true;
  const surface = panel?.dataset?.personalAgentSurface || resolvePersonalAgentSurface();
  const returnFocus = personalAgentLastFocus || personalAgentTrigger(surface);
  syncPersonalAgentOpenState(false);
  personalAgentLastFocus = null;
  if (wasOpen && restoreFocus) {
    window.requestAnimationFrame(() => {
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    });
  }
  if (!unmount) return;

  panelMountCoordinator.clear('personal-agent');
  const root = document.getElementById('personal-ai-agent-root');
  root?.removeAttribute('data-feature-context-key');
  root?.removeAttribute('data-feature-mounted');
  root?.classList.remove('is-loading-feature');
  root?.closest('#personal-ai-agent-panel')?.setAttribute('aria-busy', 'false');
  const mountedModule = featureModules.get('personal-agent');
  if (!mountedModule) {
    root?.replaceChildren();
    return;
  }
  Promise.resolve(mountedModule)
    .then((module) => {
      module.unmountPersonalAgent?.();
      root?.replaceChildren();
    })
    .catch(() => undefined);
};

window.openPersonalAgent = async function openPersonalAgent({ surface } = {}) {
  if (!window.currentUser) return;
  const activeSurface = surface === 'desktop' || surface === 'mobile'
    ? surface
    : resolvePersonalAgentSurface();
  const preferences = loadPersonalAgentPreferences();
  if (!personalAgentSurfaceIsEnabled(activeSurface, preferences)) {
    const panel = document.getElementById('personal-ai-agent-panel');
    const openSurface = panel?.dataset?.personalAgentSurface;
    const allDisabled = !personalAgentSurfaceIsEnabled('desktop', preferences)
      && !personalAgentSurfaceIsEnabled('mobile', preferences);
    if (!panel?.classList.contains('open') || openSurface === activeSurface || allDisabled) {
      window.closePersonalAgent({ unmount: allDisabled });
    }
    window.showToast?.(`Winston on ${activeSurface} is disabled in Settings → Appearance.`, false);
    return { status: 'disabled' };
  }
  loadFeatureStyles();
  closeContactsPanelIfOpen();
  if (typeof window.closeUpdatesPanel === 'function') window.closeUpdatesPanel();
  else document.getElementById('updates-panel')?.classList.remove('open');
  document.getElementById('vault-panel')?.classList.remove('open');
  const panel = document.getElementById('personal-ai-agent-panel');
  const root = document.getElementById('personal-ai-agent-root');
  if (!panel) return;
  if (!panel.classList.contains('open')) {
    const activeElement = document.activeElement;
    personalAgentLastFocus = activeElement instanceof HTMLElement && !panel.contains(activeElement)
      ? activeElement
      : personalAgentTrigger(activeSurface);
  }
  syncPersonalAgentOpenState(true, activeSurface);
  const userId = window.currentUser.uid;
  const roomId = window.activeRoomId || 'global';
  const channelId = window.activeChannelId || 'general';
  const contextKey = `${userId}:${roomId}:${channelId}`;
  const scheduled = panelMountCoordinator.schedule(
    'personal-agent',
    contextKey,
    () => importOnce('personal-agent', () => import('../ai/mountPersonalAgent.js')),
    ({ mountPersonalAgent }) => {
      mountPersonalAgent({ roomId, channelId, localAiConfig: aiConfigFromWindow() });
      if (root) root.dataset.featureMounted = 'true';
    },
    {
      cacheIsValid: () => root?.isConnected === true
        && root.dataset.featureMounted === 'true',
      isRelevant: () => panel.classList.contains('open')
        && window.currentUser?.uid === userId
        && (window.activeRoomId || 'global') === roomId
        && (window.activeChannelId || 'general') === channelId,
    },
  );
  if (scheduled.status === 'started') setPanelLoading('personal-ai-agent-root', 'Opening Winston...');
  try {
    const result = await scheduled.promise;
    if (result.status !== 'stale' || !panel.classList.contains('open')) {
      setPanelLoading('personal-ai-agent-root', 'Opening Winston...', false);
    }
    if (result.status !== 'stale') focusPersonalAgentPanel(panel);
    return result;
  } catch (error) {
    if (panel.classList.contains('open')) {
      setPanelError('personal-ai-agent-root', 'Winston failed to load', error);
      window.showToast?.(`Winston failed to load: ${error.message || error}`, true);
    }
    return { status: 'failed', error };
  }
};

window.refreshPersonalAgentContext = function refreshPersonalAgentContext() {
  const panel = document.getElementById('personal-ai-agent-panel');
  if (!panel?.classList.contains('open')) return;
  window.openPersonalAgent?.({
    surface: panel.dataset.personalAgentSurface || resolvePersonalAgentSurface(),
  });
};

window.addEventListener('minimalist:room-channel-change', () => {
  window.refreshPersonalAgentContext?.();
});

function syncPersonalAgentViewportPreference() {
  const panel = document.getElementById('personal-ai-agent-panel');
  if (!panel?.classList.contains('open')) return;
  const activeSurface = resolvePersonalAgentSurface();
  if (!personalAgentSurfaceIsEnabled(activeSurface)) {
    window.closePersonalAgent();
    return;
  }
  panel.dataset.personalAgentSurface = activeSurface;
  syncPersonalAgentOpenState(true, activeSurface);
}

const personalAgentViewportQuery = window.matchMedia?.('(max-width: 768px)');
personalAgentViewportQuery?.addEventListener?.('change', syncPersonalAgentViewportPreference);

window.prewarmVault = function prewarmVault() {
  if (vaultPrewarmPromise) return vaultPrewarmPromise;
  loadFeatureStyles();
  vaultPrewarmPromise = importOnce('vault', () => import('../vault/mountVault.js')).catch((error) => {
    vaultPrewarmPromise = null;
    throw error;
  });
  return vaultPrewarmPromise;
};

window.openVault = async function openVault(initialView = 'all') {
  if (!window.currentUser) return;
  loadFeatureStyles();
  closeContactsPanelIfOpen();
  if (typeof window.closeUpdatesPanel === 'function') window.closeUpdatesPanel();
  else document.getElementById('updates-panel')?.classList.remove('open');
  window.closePersonalAgent?.({ restoreFocus: false });
  document.getElementById('bookmarks-panel')?.classList.add('hidden');
  const panel = document.getElementById('vault-panel');
  const root = document.getElementById('vault-root');
  if (!panel) return;
  const requestedView = initialView || 'all';
  const userId = window.currentUser.uid;
  const contextKey = userId;
  panel.dataset.vaultView = requestedView;
  panel.classList.add('open');
  window.dispatchEvent(new CustomEvent('minimalist:vault-open', { detail: { view: requestedView } }));
  const scheduled = panelMountCoordinator.schedule(
    'vault',
    contextKey,
    () => vaultPrewarmPromise || importOnce('vault', () => import('../vault/mountVault.js')),
    ({ mountVault }) => {
      mountVault({
        userId,
        userName: window.userProfileName || window.currentUser?.displayName || 'You',
        initialView: requestedView,
        bookmarks: window.__bookmarkIds || {},
      });
      if (root) root.dataset.featureMounted = 'true';
    },
    {
      cacheIsValid: () => root?.isConnected === true
        && root.dataset.featureMounted === 'true',
      isRelevant: () => panel.classList.contains('open') && window.currentUser?.uid === userId,
    },
  );
  if (scheduled.status === 'started') setPanelLoading('vault-root', 'Opening vault...');
  try {
    const result = await scheduled.promise;
    if (result.status !== 'stale' || !panel.classList.contains('open')) {
      setPanelLoading('vault-root', 'Opening vault...', false);
    }
    return result;
  } catch (error) {
    if (panel.classList.contains('open')) {
      setPanelError('vault-root', 'Vault failed to load', error);
      window.showToast?.(`Vault failed to load: ${error.message || error}`, true);
    }
    return { status: 'failed', error };
  }
};

['#open-vault-btn', '#open-vault-btn-mobile'].forEach((selector) => {
  const shouldPrewarm = (target) => target instanceof Element && target.closest(selector);
  document.addEventListener('pointerenter', (event) => {
    if (shouldPrewarm(event.target)) window.prewarmVault?.();
  }, true);
  document.addEventListener('touchstart', (event) => {
    if (shouldPrewarm(event.target)) window.prewarmVault?.();
  }, { passive: true, capture: true });
  document.addEventListener('focusin', (event) => {
    if (shouldPrewarm(event.target)) window.prewarmVault?.();
  }, true);
});
