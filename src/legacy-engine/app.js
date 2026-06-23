// js/app.js
// Temporary bridge while the chat shell finishes moving from legacy DOM code to React/Vite modules.
import '../features/shell/globalState.js';
import '../features/shell/uiShell.js';
import '../features/settings/settingsService.js';
import '../features/onboarding/welcomeTour.js';
import '../features/shell/backgroundServices.js';
import '../features/shell/chatShellControls.js';
import '../features/shell/chatBoot.js';
import '../features/shell/nativePlatform.js';
import '../features/chat-core/emojiPicker.js';
import '../features/admin/adminTools.js';
import '../features/profile/profileActions.js';
import '../features/profile/profilePopupService.js';
import '../features/contacts/contactsService.js';
import './auth.js';
import './rooms.js';
import './docs.js';
import './whiteboard.js';
import './roomhome.js';
import './pages.js';
import './tasks.js';
import './events.js';
import './calendar.js';
import './ai.js';
import './calls.js';
import './search.js';
import '../features/community/social.js';
import '../features/community/gamify.js';
import '../features/message-tools/messageTools.js';
import '../features/notifications/notificationService.js';
import '../features/presence/presenceService.js';
import '../features/private-messages/pmInboxService.js';
import '../features/updates/githubUpdates.js';
import { initializeBillingActions } from '../features/billing/billingActions.js';

initializeBillingActions();
