// Chat app entrypoint for the React/Vite shell.
import './globalState.js';
import { applySavedTheme } from '../settings/themeRuntime.js';
import {
  applyPersonalAgentPreferences,
  loadPersonalAgentPreferences,
  PERSONAL_AGENT_PREFERENCE_EVENT,
  PERSONAL_AGENT_PREFERENCE_STORAGE_KEYS,
} from '../ai/personalAgentPreference.js';
import { mountChatCore, switchChatRoom } from '../chat-core/mountChatCore.js';
import './uiShell.js';
import '../performance/performanceSettings.js';
import './backgroundServices.js';
import './chatShellControls.js';
import './chatBoot.js';
import './nativePlatform.js';
import './roomFeatureLoaders.js';
import './authGate.js';
import '../presence/presenceService.js';

applySavedTheme({ updateSelection: false });
applyPersonalAgentPreferences(loadPersonalAgentPreferences());

const readFeatureMode = () => {
  try {
    return window.localStorage.getItem('minimalistMarketingMode') === 'power'
      ? 'power'
      : 'simple';
  } catch {
    return 'simple';
  }
};
window.getFeatureMode = readFeatureMode;
window.isSimpleFeatureMode = () => readFeatureMode() === 'simple';
document.body.classList.remove('simple-feature-mode', 'power-feature-mode');
document.body.classList.add(`${readFeatureMode()}-feature-mode`);

window.addEventListener(PERSONAL_AGENT_PREFERENCE_EVENT, (event) => {
  applyPersonalAgentPreferences(event.detail?.preferences || loadPersonalAgentPreferences());
});
window.addEventListener('storage', (event) => {
  if (event.key === null || PERSONAL_AGENT_PREFERENCE_STORAGE_KEYS.includes(event.key)) {
    applyPersonalAgentPreferences(loadPersonalAgentPreferences());
  }
});

const lazyServices = new Map();
const loadedServices = new Set();
const pendingDeferredTriggers = new WeakSet();

function importServiceOnce(key, importer) {
  if (!lazyServices.has(key)) {
    lazyServices.set(
      key,
      Promise.resolve()
        .then(importer)
        .then((module) => {
          loadedServices.add(key);
          return module;
        })
        .catch((error) => {
          lazyServices.delete(key);
          loadedServices.delete(key);
          throw error;
        })
    );
  }
  return lazyServices.get(key);
}

function ensureDeferredChatSurfaces() {
  if (typeof window.ensureChatDeferredSurfaces === 'function') {
    return window.ensureChatDeferredSurfaces();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('minimalist:deferred-surfaces-ready', handleReady);
      window.removeEventListener('minimalist:deferred-surfaces-error', handleError);
      callback(value);
    };
    const handleReady = () => finish(resolve, true);
    const handleError = (event) => finish(
      reject,
      event.detail?.error || new Error('Additional Chat controls could not be loaded.'),
    );
    const timeoutId = window.setTimeout(() => finish(
      reject,
      new Error('Additional Chat controls took too long to load.'),
    ), 12000);

    window.addEventListener('minimalist:deferred-surfaces-ready', handleReady, { once: true });
    window.addEventListener('minimalist:deferred-surfaces-error', handleError, { once: true });
    window.dispatchEvent(new Event('minimalist:deferred-surfaces-request'));

    window.setTimeout(() => {
      if (settled || typeof window.ensureChatDeferredSurfaces !== 'function') return;
      window.ensureChatDeferredSurfaces().then(handleReady, (error) => finish(reject, error));
    }, 0);
  });
}

function withDeferredChatSurfaces(importer) {
  return async () => {
    await ensureDeferredChatSurfaces();
    return importer();
  };
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

window.initializeRooms = function initializeCoreRooms() {
  if (!window.currentUser?.uid) {
    throw new Error('Sign-in is still loading. Please refresh or sign in again.');
  }

  const chatCoreReady = mountChatCore({ user: window.currentUser });
  if (window.innerWidth <= 768) {
    document.getElementById('desktop-room-sidebar')?.classList.add('open');
  }
  return chatCoreReady;
};
window.switchRoom = switchChatRoom;

const dialogHostImporter = () => import('./dialogHost.jsx');
lazyWindowFunction('dialog-host', dialogHostImporter, 'appConfirm');

const privateMessagesImporter = withDeferredChatSurfaces(
  () => import('../private-messages/PrivateMessages.jsx'),
);
window.ensurePrivateMessagesRuntime = () => importServiceOnce(
  'private-messages-ui',
  privateMessagesImporter,
);
lazyWindowFunction('private-messages-ui', privateMessagesImporter, 'openPrivateChat');
lazyWindowFunction('private-messages-ui', privateMessagesImporter, 'startPrivateCallWithFriend');

function renderDeferredListError(error, options) {
  import('./deferredListImportError.js')
    .then(({ renderDeferredListImportError }) => {
      renderDeferredListImportError(error, options);
    })
    .catch(() => {
      window.showToast?.(`${options.label} could not be opened. Please try again.`);
    });
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
  await ensureDeferredChatSurfaces();
  await importServiceOnce('community-services', communityServicesImporter);
  return import('../profile/profilePopupService.js');
};
const settingsServiceImporter = withDeferredChatSurfaces(async () => {
  const [settingsService] = await Promise.all([
    import('../settings/settingsService.js'),
    import('../profile/profileActions.js'),
  ]);
  return settingsService;
});
const messageToolsImporter = withDeferredChatSurfaces(
  () => import('../message-tools/messageTools.js'),
);
const roomControlsImporter = withDeferredChatSurfaces(
  () => import('../rooms/roomControls.js'),
);
const emojiPickerImporter = withDeferredChatSurfaces(
  () => import('../chat-core/emojiPicker.js'),
);
const adminToolsImporter = withDeferredChatSurfaces(
  () => import('../admin/adminTools.js'),
);
const welcomeTourImporter = withDeferredChatSurfaces(
  () => import('../onboarding/welcomeTour.js'),
);
const billingActionsImporter = withDeferredChatSurfaces(async () => {
  const billingActions = await import('../billing/billingActions.js');
  window.initializeBillingActions = billingActions.initializeBillingActions;
  billingActions.initializeBillingActions();
  return billingActions;
});
window.prefetchProfilePopupService = () => importServiceOnce('profile-popup-service', profilePopupServiceImporter);

lazyWindowFunction('settings-service', settingsServiceImporter, 'openSettings');
lazyWindowFunction('settings-service', settingsServiceImporter, 'setFeatureMode');
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
lazyWindowFunction('room-controls', roomControlsImporter, 'openJoinRoomModal');
lazyWindowFunction('room-controls', roomControlsImporter, 'openCreateRoomModal');
lazyWindowFunction('room-controls', roomControlsImporter, 'joinRoomFromInvite');
lazyWindowFunction('room-controls', roomControlsImporter, 'normalizeRoomInviteCode');
lazyWindowFunction('emoji-picker', emojiPickerImporter, 'ensureEmojiPickerOptions');
lazyWindowFunction('welcome-tour', welcomeTourImporter, 'showWelcomeTour');

window.maybeShowWelcomeTour = async () => {
  try {
    if (!window.sessionStorage.getItem('showWelcomeTour')) return false;
  } catch {
    return false;
  }
  await importServiceOnce('welcome-tour', welcomeTourImporter);
  return window.maybeShowWelcomeTour?.();
};

const deferredInteractionLoaders = [
  {
    selector: '#open-settings-btn, #open-settings-btn-mobile',
    key: 'settings-service',
    importer: settingsServiceImporter,
  },
  {
    selector: '#create-room-btn, #join-room-btn, #room-drop-settings',
    key: 'room-controls',
    importer: roomControlsImporter,
  },
  {
    selector: '[aria-controls="emoji-picker"]',
    key: 'emoji-picker',
    importer: emojiPickerImporter,
  },
  {
    selector: '#upgrade-advanced-btn, #upgrade-pro-btn, #manage-billing-btn',
    key: 'billing-actions',
    importer: billingActionsImporter,
  },
  {
    selector: '#mini-admin-blip',
    key: 'admin-tools',
    importer: adminToolsImporter,
  },
  {
    selector: '#open-search-btn, #open-search-btn-mobile, #open-updates-btn, #open-updates-btn-mobile',
    key: 'deferred-surfaces',
    importer: ensureDeferredChatSurfaces,
  },
];

function deferredInteractionFor(target) {
  if (!(target instanceof Element)) return null;
  for (const entry of deferredInteractionLoaders) {
    const trigger = target.closest(entry.selector);
    if (trigger) return { ...entry, trigger };
  }
  return null;
}

function warmDeferredInteraction(event) {
  const match = deferredInteractionFor(event.target);
  if (!match || loadedServices.has(match.key)) return;
  importServiceOnce(match.key, match.importer).catch(() => {});
}

function runDeferredInteraction(event) {
  const match = deferredInteractionFor(event.target);
  if (!match || loadedServices.has(match.key)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const { trigger } = match;
  if (pendingDeferredTriggers.has(trigger)) return;
  pendingDeferredTriggers.add(trigger);
  trigger.setAttribute('aria-busy', 'true');

  importServiceOnce(match.key, match.importer)
    .then(() => {
      pendingDeferredTriggers.delete(trigger);
      trigger.removeAttribute('aria-busy');
      if (trigger.isConnected && !trigger.disabled) {
        trigger.focus?.({ preventScroll: true });
        trigger.click();
      }
    })
    .catch((error) => {
      pendingDeferredTriggers.delete(trigger);
      trigger.removeAttribute('aria-busy');
      window.showToast?.(error?.message || 'This control could not be opened. Please try again.');
      trigger.focus?.({ preventScroll: true });
    });
}

document.addEventListener('pointerover', warmDeferredInteraction, { capture: true, passive: true });
document.addEventListener('focusin', warmDeferredInteraction, true);
document.addEventListener('click', runDeferredInteraction, true);

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
  'resolveUserRef',
  'giveCommunityAward',
  'awardXP',
  'trackQuest',
  'bumpStreak',
].forEach((name) => lazyWindowFunction('community-services', communityServicesImporter, name));

lazyWindowFunction('community-services', communityServicesImporter, 'renderLeaderboard', {
  onError: (error) => renderDeferredListError(error, {
    hostId: 'leaderboard-list',
    label: 'Rank',
    retryName: 'renderLeaderboard',
  }),
});

lazyWindowFunction('community-services', communityServicesImporter, 'renderRecognition', {
  onError: (error) => renderDeferredListError(error, {
    hostId: 'recognition-list',
    label: 'Kudos',
    retryName: 'renderRecognition',
  }),
});

lazyWindowFunction('community-services', communityServicesImporter, 'renderQuests', {
  onError: (error) => renderDeferredListError(error, {
    hostId: 'quests-list',
    label: 'quests',
    retryArgs: { restoreFocus: true },
    retryName: 'renderQuests',
  }),
});

const prefetchContactsService = () => importServiceOnce('contacts-service', contactsServiceImporter).catch((error) => {
    console.warn('Contacts service prefetch failed.', error);
  });

const warmContactsOnIntent = (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (target?.closest?.('.pm-open-btn, #up-message-btn')) {
    window.ensurePrivateMessagesRuntime?.().catch(() => {});
  }
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

const returnParams = new URLSearchParams(window.location.search);
const hasAccountBillingReturn = ['success', 'cancelled', 'portal-return']
  .includes(returnParams.get('billing'));
const hasRoomBillingReturn = ['success', 'cancelled', 'portal-return']
  .includes(returnParams.get('room_billing'));

if (hasAccountBillingReturn || hasRoomBillingReturn) {
  window.addEventListener('minimalist:chat-interactive', () => {
    if (hasAccountBillingReturn) {
      importServiceOnce('billing-actions', billingActionsImporter).catch((error) => {
        window.showToast?.(error?.message || 'Account billing could not be refreshed.');
      });
    }

    if (hasRoomBillingReturn) {
      importServiceOnce('room-controls', roomControlsImporter)
        .then(() => window.initializeRooms?.())
        .catch((error) => {
          window.showToast?.(error?.message || 'Room billing could not be refreshed.');
        });
    }
  }, { once: true });
}
