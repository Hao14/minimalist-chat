// Chat app entrypoint for the React/Vite shell.
import './globalState.js';
import { applySavedTheme } from '../settings/themeRuntime.js';
import {
  applyPersonalAgentPreferences,
  loadPersonalAgentPreferences,
  PERSONAL_AGENT_PREFERENCE_EVENT,
  PERSONAL_AGENT_PREFERENCE_STORAGE_KEYS,
} from '../ai/personalAgentPreference.js';
import './uiShell.js';
import './dialogHost.jsx';
import '../performance/performanceSettings.js';
import '../onboarding/welcomeTour.js';
import './backgroundServices.js';
import './chatShellControls.js';
import './chatBoot.js';
import './nativePlatform.js';
import './roomFeatureLoaders.js';
import '../chat-core/emojiPicker.js';
import '../admin/adminTools.js';
import '../profile/profileActions.js';
import './authGate.js';
import '../rooms/roomControls.js';
import '../presence/presenceService.js';
import '../private-messages/PrivateMessages.jsx';
import { initializeBillingActions } from '../billing/billingActions.js';

applySavedTheme({ updateSelection: false });
applyPersonalAgentPreferences(loadPersonalAgentPreferences());

window.addEventListener(PERSONAL_AGENT_PREFERENCE_EVENT, (event) => {
  applyPersonalAgentPreferences(event.detail?.preferences || loadPersonalAgentPreferences());
});
window.addEventListener('storage', (event) => {
  if (event.key === null || PERSONAL_AGENT_PREFERENCE_STORAGE_KEYS.includes(event.key)) {
    applyPersonalAgentPreferences(loadPersonalAgentPreferences());
  }
});

const lazyServices = new Map();

function importServiceOnce(key, importer) {
  if (!lazyServices.has(key)) {
    lazyServices.set(
      key,
      importer().catch((error) => {
        lazyServices.delete(key);
        throw error;
      })
    );
  }
  return lazyServices.get(key);
}

function lazyWindowFunction(key, importer, name, { onError } = {}) {
  window[name] = async (...args) => {
    try {
      await importServiceOnce(key, importer);
      return window[name]?.(...args);
    } catch (error) {
      if (!onError) throw error;
      onError(error);
      return false;
    }
  };
}

function renderQuestImportError(error) {
  console.error('Quest module failed to load.', error);
  const host = document.getElementById('quests-list');
  if (!host) return;

  const state = document.createElement('li');
  state.className = 'activity-state activity-state-error';
  state.setAttribute('role', 'alert');

  const iconWrap = document.createElement('span');
  iconWrap.className = 'activity-state-icon';
  iconWrap.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('i');
  icon.className = 'ph-bold ph-cloud-slash';
  iconWrap.append(icon);

  const title = document.createElement('strong');
  title.textContent = "Couldn't open quests";
  const message = document.createElement('p');
  message.textContent = navigator.onLine === false
    ? 'Reconnect, then try the Quest board again.'
    : 'The Quest board did not finish loading. You can retry without closing Updates.';

  const actions = document.createElement('div');
  actions.className = 'activity-state-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => {
    retry.disabled = true;
    retry.textContent = 'Retrying…';
    window.renderQuests?.({ restoreFocus: true });
  });
  actions.append(retry);

  state.append(iconWrap, title, message, actions);
  host.setAttribute('aria-busy', 'false');
  host.replaceChildren(state);
}

const notificationRuntimeImporter = () => Promise.all([
  import('../notifications/notificationService.js'),
  import('../private-messages/pmInboxService.js'),
]);
window.ensureNotificationRuntime = () => importServiceOnce('notification-runtime', notificationRuntimeImporter);

const communityServicesImporter = () => Promise.all([
  import('../community/social.js'),
  import('../community/gamify.js'),
]);
window.ensureCommunityRuntime = () => importServiceOnce('community-services', communityServicesImporter);
const contactsServiceImporter = async () => {
  await importServiceOnce('community-services', communityServicesImporter);
  return import('../contacts/contactsService.js');
};
const profilePopupServiceImporter = async () => {
  await importServiceOnce('community-services', communityServicesImporter);
  return import('../profile/profilePopupService.js');
};
const settingsServiceImporter = () => import('../settings/settingsService.js');
const messageToolsImporter = () => import('../message-tools/messageTools.js');
window.prefetchProfilePopupService = () => importServiceOnce('profile-popup-service', profilePopupServiceImporter);

lazyWindowFunction('settings-service', settingsServiceImporter, 'openSettings');
lazyWindowFunction('profile-popup-service', profilePopupServiceImporter, 'viewUserProfile');
lazyWindowFunction('profile-popup-service', profilePopupServiceImporter, 'renderProfileSpotlight');
lazyWindowFunction('contacts-service', contactsServiceImporter, 'openContactsPanel');
lazyWindowFunction('contacts-service', contactsServiceImporter, 'closeContactsPanel');
lazyWindowFunction('contacts-service', contactsServiceImporter, 'toggleContacts');
lazyWindowFunction('contacts-service', contactsServiceImporter, 'renderContactsUI');
lazyWindowFunction('message-tools', messageToolsImporter, 'openMsgMenu');
lazyWindowFunction('message-tools', messageToolsImporter, 'openBookmarks');
lazyWindowFunction('message-tools', messageToolsImporter, 'initMessageTools');
lazyWindowFunction('github-updates', () => import('../updates/githubUpdates.js'), 'fetchGitHubUpdates');

[
  'awardBadge',
  'giveKudos',
  'notifyMentions',
  'bumpMessageCount',
  'toggleFollow',
  'isFollowing',
  'getFollowCounts',
  'getMutualRooms',
  'openProfileByRef',
  'generateSpotlight',
  'buildSkills',
  'endorseSkill',
  'renderLeaderboard',
  'resolveUserRef',
  'giveCommunityAward',
  'renderRecognition',
  'awardXP',
  'trackQuest',
  'bumpStreak',
].forEach((name) => lazyWindowFunction('community-services', communityServicesImporter, name));

lazyWindowFunction('community-services', communityServicesImporter, 'renderQuests', {
  onError: renderQuestImportError,
});

const prefetchContactsService = () => importServiceOnce('contacts-service', contactsServiceImporter).catch((error) => {
    console.warn('Contacts service prefetch failed.', error);
  });

const prefetchProfilePopupService = () => importServiceOnce('profile-popup-service', profilePopupServiceImporter).catch((error) => {
    console.warn('Profile service prefetch failed.', error);
  });

const warmContactsOnIntent = (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (target?.closest?.('#open-contacts-btn, #open-contacts-btn-mobile')) {
    prefetchContactsService();
    return;
  }
  if (target?.closest?.('.msg-menu-icon, #open-bookmarks-btn')) {
    importServiceOnce('message-tools', messageToolsImporter).catch(() => {});
  }
};
document.addEventListener('pointerdown', warmContactsOnIntent, { capture: true, passive: true });
document.addEventListener('focusin', warmContactsOnIntent, true);

const prefetchContactsAfterFirstPaint = () => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const constrainedConnection = connection?.saveData || /(?:slow-)?2g/i.test(connection?.effectiveType || '');
  const constrainedMemory = Number(navigator.deviceMemory || 0) > 0 && Number(navigator.deviceMemory) <= 4;
  if (document.visibilityState === 'hidden' || constrainedConnection || constrainedMemory) return;

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(prefetchContactsService, { timeout: 1200 });
      } else {
        window.setTimeout(prefetchContactsService, 120);
      }
    }));
  } else {
    window.setTimeout(prefetchContactsService, 0);
  }
};
prefetchContactsAfterFirstPaint();

const canPrefetchProfile = (() => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const constrainedConnection = connection?.saveData || /(?:slow-)?2g/i.test(connection?.effectiveType || '');
  const constrainedMemory = Number(navigator.deviceMemory || 0) > 0 && Number(navigator.deviceMemory) <= 4;
  return document.visibilityState !== 'hidden' && !constrainedConnection && !constrainedMemory;
})();

if (canPrefetchProfile) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(prefetchProfilePopupService, { timeout: 4500 });
  } else {
    window.setTimeout(prefetchProfilePopupService, 2600);
  }
}

initializeBillingActions();
