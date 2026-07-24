// config.js — runtime keys for optional integrations.
// Plain values, loaded before app.js. (A Google OAuth client id is NOT a secret —
// it's sent to the browser anyway — so it's fine here. Real secrets like the
// Anthropic API key live only in the Cloud Function, never in this file.)

// Google Calendar — your OAuth client id (Calendar API enabled in Google Cloud).
// IMPORTANT: in Google Cloud Console, add your app origins to the OAuth client's
// "Authorized JavaScript origins" or the popup will fail, e.g.:
//   http://localhost:5000   (Firebase hosting emulator)
//   https://chat-app-356c1.web.app   and your custom domain
window.GCAL_CLIENT_ID = '327658376387-4k2vr4612m66vtqlo7e96fqsf2jdt54q.apps.googleusercontent.com';
window.GOOGLE_AUTH_CLIENT_ID = '327658376387-48ots8pnboooefrb13i3i42jn9v073jv.apps.googleusercontent.com';
window.GOOGLE_AUTH_ALLOWED_ORIGINS = [
  'https://minimalist.chat',
  'https://www.minimalist.chat',
  'https://chat-app-356c1.web.app',
  'https://chat-app-356c1.firebaseapp.com',
];
// Firebase Auth should use the current host only when that host is already added in
// Firebase Console -> Authentication -> Settings -> Authorized domains.
window.FIREBASE_AUTH_SAME_ORIGIN_HOSTS = [
  'minimalist.chat',
  'www.minimalist.chat',
  'chat-app-356c1.web.app',
  'chat-app-356c1.firebaseapp.com',
];

// Firebase App Check — add your Web App Check reCAPTCHA v3 site key here. RUM
// collection is disabled until this is configured, and its endpoint always
// requires a valid App Check token independently of the optional global flag.
window.FIREBASE_APP_CHECK_SITE_KEY = '';
window.FIREBASE_APP_CHECK_DEBUG_TOKEN = '';

// AI — public deployments use the authenticated Firebase gateway; local dev can switch this back to local.
// Keep this loopback-only. Do not put secrets here.
window.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
// Text requests expose only the Fast/Smart profile choice. Firebase owns the
// final model mapping; these tags are used only for loopback local development.
window.OLLAMA_FAST_MODEL = 'qwen3:4b-instruct';
window.OLLAMA_SMART_MODEL = 'qwen3:14b';
window.OLLAMA_MODEL = window.OLLAMA_FAST_MODEL; // Legacy local-client alias.
window.AI_MODEL_PROFILE = 'fast';
window.OLLAMA_VISION_MODEL = 'qwen2.5vl:7b';

// AI runtime mode:
//   local   = browser talks to loopback Ollama on this device.
//   gateway = browser talks to authenticated Firebase Functions, which can proxy a private Ollama server.
window.AI_PROVIDER = 'gateway';
window.AI_GATEWAY_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/aiGateway';
window.AI_PROFILE_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/personalAiProfile';
window.VAULT_SHARE_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/createVaultShare';
window.ISSUE_DRAFT_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/submitIssueDraft';
window.NOTIFICATION_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/createNotification';
window.LINK_PREVIEW_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/linkPreview';
window.PERFORMANCE_RUM_ENDPOINT = '/api/performance/vitals';
window.MINIMALIST_FLAGS = {
  aiGateway: true,
  aiServerProfile: true,
  bananas: true,
  issueSubmission: true,
  serverNotifications: true,
  // Vault share links must be created through the authenticated Cloud Function.
  vaultShareBackend: true,
  callsV2: true,
  pwaInstall: true,
  performanceRum: Boolean(window.FIREBASE_APP_CHECK_SITE_KEY),
};
window.CALLS_V2_ENABLED = true;

// Calendar photo import uses the authenticated Firebase gateway in public mode.
window.AI_CALENDAR_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/extractCalendar';

// Legacy cloud text AI endpoints are intentionally disabled for webpage text AI.
window.AI_CHAT_ENDPOINT = '';

// Legacy Pro personal AI endpoint. Text AI now uses the authenticated aiGateway.
window.PERSONAL_AI_AGENT_ENDPOINT = '';

// Bot Marketplace — authenticated stock quote endpoint for the Stock Price Tracker bot.
window.STOCK_QUOTE_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stockQuote';

// Room connections — authenticated save, test, and disconnect operations keep
// webhook credential URLs out of client-readable room metadata.
window.ROOM_WEBHOOK_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/roomWebhookConnection';

// Room privacy — invite joins and private room list backfill run through authenticated Functions.
window.JOIN_ROOM_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/joinRoomByInvite';
window.MY_ROOMS_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/listMyRooms';
window.ROOM_SEARCH_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/searchDiscoverableRooms';
window.JOIN_DISCOVERABLE_ROOM_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/joinDiscoverableRoom';

// Stripe billing — deployed Firebase Cloud Function URLs.
// Set these after deploying functions:
//   firebase deploy --only functions:stripeCreateCheckoutSession,functions:stripeCreatePortalSession,functions:stripeSyncCheckoutSession,functions:stripeCreateRoomCheckoutSession,functions:stripeSyncRoomCheckoutSession,functions:stripeCreateRoomPortalSession,functions:stripeUpdateRoomBenefitUsers,functions:stripeWebhook
// Paste your Stripe publishable key here to enable embedded checkout. Publishable keys are browser-safe.
// IMPORTANT: production hosts such as https://chat-app-356c1.web.app must use a live
// publishable key (`pk_live_...`). Leaving a `pk_test_...` key here should be treated
// as a deploy blocker; billingActions.js will warn and fall back to hosted checkout.
window.STRIPE_PUBLISHABLE_KEY = 'pk_live_51QgFVBK2lNxMjmQ4yCT0vY8UoByvPSEmnYArsAJk8KSpNFQQK09c7OWYOHx8f5H5wUbJYPjg8xJ9w5607Mn9bNhw00klN4DQuJ';
window.STRIPE_CHECKOUT_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreateCheckoutSession';
window.STRIPE_PORTAL_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreatePortalSession';
window.STRIPE_SYNC_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeSyncCheckoutSession';
window.ROOM_BILLING_CHECKOUT_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreateRoomCheckoutSession';
window.ROOM_BILLING_SYNC_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeSyncRoomCheckoutSession';
window.ROOM_BILLING_PORTAL_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreateRoomPortalSession';
window.ROOM_BILLING_USERS_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeUpdateRoomBenefitUsers';

if (
  window.location?.hostname === 'chat-app-356c1.web.app'
  && String(window.STRIPE_PUBLISHABLE_KEY || '').startsWith('pk_test_')
) {
  console.warn(
    '[Stripe] chat-app-356c1.web.app is serving a test publishable key. Replace window.STRIPE_PUBLISHABLE_KEY with the live pk_live_ key before production billing goes out.'
  );
}

// Phone push notifications — paste your Firebase Web Push certificate public VAPID key here.
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates.
// Browser/PWA alerts still work without this, but fully closed-app phone push needs it.
window.FCM_VAPID_KEY = 'BDVBDNMx-30ZyG7KX4Ot89StjLhC8lmx6ITE0vNLfsuXTA-zcC5H9tcmyCPno50bz-4DJDbKmj2fIbu5qw3uwpQ';
