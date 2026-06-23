// Chat app entrypoint for the React/Vite shell.
// The remaining legacy-engine imports are compatibility adapters while those
// behaviors continue moving into feature-owned React modules.
import './globalState.js';
import './uiShell.js';
import '../settings/settingsService.js';
import '../onboarding/welcomeTour.js';
import './backgroundServices.js';
import './chatShellControls.js';
import './chatBoot.js';
import './nativePlatform.js';
import '../chat-core/emojiPicker.js';
import '../admin/adminTools.js';
import '../profile/profileActions.js';
import '../profile/profilePopupService.js';
import '../contacts/contactsService.js';
import '../../legacy-engine/auth.js';
import '../../legacy-engine/rooms.js';
import '../../legacy-engine/docs.js';
import '../../legacy-engine/whiteboard.js';
import '../../legacy-engine/roomhome.js';
import '../../legacy-engine/pages.js';
import '../../legacy-engine/tasks.js';
import '../../legacy-engine/events.js';
import '../../legacy-engine/calendar.js';
import '../../legacy-engine/ai.js';
import '../../legacy-engine/calls.js';
import '../../legacy-engine/search.js';
import '../community/social.js';
import '../community/gamify.js';
import '../message-tools/messageTools.js';
import '../notifications/notificationService.js';
import '../presence/presenceService.js';
import '../private-messages/pmInboxService.js';
import '../updates/githubUpdates.js';
import { initializeBillingActions } from '../billing/billingActions.js';

initializeBillingActions();
