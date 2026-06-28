// Chat app entrypoint for the React/Vite shell.
import './globalState.js';
import { applySavedTheme } from '../settings/themeRuntime.js';
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
import '../community/social.js';
import '../community/gamify.js';
import '../message-tools/messageTools.js';
import '../notifications/notificationService.js';
import '../presence/presenceService.js';
import '../private-messages/PrivateMessages.jsx';
import '../private-messages/pmInboxService.js';
import { initializeBillingActions } from '../billing/billingActions.js';

applySavedTheme({ updateSelection: false });

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

function lazyWindowFunction(key, importer, name) {
  window[name] = async (...args) => {
    await importServiceOnce(key, importer);
    return window[name]?.(...args);
  };
}

lazyWindowFunction('settings-service', () => import('../settings/settingsService.js'), 'openSettings');
lazyWindowFunction('profile-popup-service', () => import('../profile/profilePopupService.js'), 'viewUserProfile');
lazyWindowFunction('profile-popup-service', () => import('../profile/profilePopupService.js'), 'renderSettingsCardPreview');
lazyWindowFunction('profile-popup-service', () => import('../profile/profilePopupService.js'), 'renderProfileSpotlight');
lazyWindowFunction('contacts-service', () => import('../contacts/contactsService.js'), 'openContactsPanel');
lazyWindowFunction('contacts-service', () => import('../contacts/contactsService.js'), 'closeContactsPanel');
lazyWindowFunction('contacts-service', () => import('../contacts/contactsService.js'), 'toggleContacts');
lazyWindowFunction('contacts-service', () => import('../contacts/contactsService.js'), 'renderContactsUI');
lazyWindowFunction('github-updates', () => import('../updates/githubUpdates.js'), 'fetchGitHubUpdates');

initializeBillingActions();
