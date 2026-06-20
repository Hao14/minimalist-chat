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

// LemonSqueezy billing — checkout + customer-portal URLs (optional).
window.LS_ADVANCED_URL = '';
window.LS_PRO_URL = '';
window.LS_PORTAL_URL = '';
