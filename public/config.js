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

// AI — public deployments use the authenticated Firebase gateway; local dev can switch this back to local.
// Keep this loopback-only. Do not put secrets here.
window.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
window.OLLAMA_MODEL = 'llama3.1:latest';
window.OLLAMA_VISION_MODEL = 'qwen2.5vl:7b';

// AI runtime mode:
//   local   = browser talks to loopback Ollama on this device.
//   gateway = browser talks to authenticated Firebase Functions, which can proxy a private Ollama server.
window.AI_PROVIDER = 'gateway';
window.AI_GATEWAY_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/aiGateway';
window.AI_PROFILE_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/personalAiProfile';
window.VAULT_SHARE_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/createVaultShare';
window.MINIMALIST_FLAGS = {
  aiGateway: true,
  aiServerProfile: true,
  bananas: true,
  // Vault share links must be created through the authenticated Cloud Function.
  vaultShareBackend: true,
  callsV2: true,
  pwaInstall: true,
};
window.CALLS_V2_ENABLED = true;

// Calendar photo import uses the authenticated Firebase gateway in public mode.
window.AI_CALENDAR_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/extractCalendar';

// Legacy cloud text AI endpoints are intentionally disabled for webpage text AI.
window.AI_CHAT_ENDPOINT = '';

// Legacy Pro personal AI Function endpoint. The webpage now uses local Ollama text AI.
window.PERSONAL_AI_AGENT_ENDPOINT = '';

// Bot Marketplace — authenticated stock quote endpoint for the Stock Price Tracker bot.
window.STOCK_QUOTE_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stockQuote';

// Stripe billing — deployed Firebase Cloud Function URLs.
// Set these after deploying functions:
//   firebase deploy --only functions:stripeCreateCheckoutSession,functions:stripeCreatePortalSession,functions:stripeSyncCheckoutSession,functions:stripeWebhook
// Paste your Stripe publishable key here to enable embedded checkout. Publishable keys are browser-safe.
window.STRIPE_PUBLISHABLE_KEY = 'pk_test_51QgFVBK2lNxMjmQ44C7NfSmjFWmuSO7sPu34n6zksVcpCNrE6BznJHm9jmoqK3I7hMzg2KvnXRiELMUVVAPioUq900u7pMPSxj';
window.STRIPE_CHECKOUT_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreateCheckoutSession';
window.STRIPE_PORTAL_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreatePortalSession';
window.STRIPE_SYNC_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeSyncCheckoutSession';

// Phone push notifications — paste your Firebase Web Push certificate public VAPID key here.
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates.
// Browser/PWA alerts still work without this, but fully closed-app phone push needs it.
window.FCM_VAPID_KEY = '';
