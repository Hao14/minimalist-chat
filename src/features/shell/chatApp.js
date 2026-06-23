// Chat app entrypoint for the React/Vite shell.
import './globalState.js';
import './uiShell.js';
import '../settings/settingsService.js';
import '../onboarding/welcomeTour.js';
import './backgroundServices.js';
import './chatShellControls.js';
import './chatBoot.js';
import './nativePlatform.js';
import './roomFeatureLoaders.js';
import '../chat-core/emojiPicker.js';
import '../admin/adminTools.js';
import '../profile/profileActions.js';
import '../profile/profilePopupService.js';
import '../contacts/contactsService.js';
import './authGate.js';
import '../rooms/roomControls.js';
import '../community/social.js';
import '../community/gamify.js';
import '../message-tools/messageTools.js';
import '../notifications/notificationService.js';
import '../presence/presenceService.js';
import '../private-messages/pmInboxService.js';
import '../updates/githubUpdates.js';
import { initializeBillingActions } from '../billing/billingActions.js';

initializeBillingActions();
