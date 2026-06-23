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

// AI photo import — the deployed extractCalendar Cloud Function URL.
// Fill this in after `firebase deploy --only functions` prints the URL, e.g.:
//   https://us-central1-chat-app-356c1.cloudfunctions.net/extractCalendar
window.AI_CALENDAR_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/extractCalendar';

// AI assistant chat — the deployed aiChat Cloud Function URL (Groq-backed). Same deploy step:
//   https://us-central1-chat-app-356c1.cloudfunctions.net/aiChat
window.AI_CHAT_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/aiChat';

// Pro personal AI agent — authenticated and tier-checked in Firebase Functions.
window.PERSONAL_AI_AGENT_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/personalAiAgent';

// Stripe billing — deployed Firebase Cloud Function URLs.
// Set these after deploying functions:
//   firebase deploy --only functions:stripeCreateCheckoutSession,functions:stripeCreatePortalSession,functions:stripeSyncCheckoutSession,functions:stripeWebhook
// Paste your Stripe publishable key here to enable embedded checkout. Publishable keys are browser-safe.
window.STRIPE_PUBLISHABLE_KEY = 'pk_test_51QgFVBK2lNxMjmQ44C7NfSmjFWmuSO7sPu34n6zksVcpCNrE6BznJHm9jmoqK3I7hMzg2KvnXRiELMUVVAPioUq900u7pMPSxj';
window.STRIPE_CHECKOUT_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreateCheckoutSession';
window.STRIPE_PORTAL_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeCreatePortalSession';
window.STRIPE_SYNC_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stripeSyncCheckoutSession';
