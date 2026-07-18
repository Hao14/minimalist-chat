# Full-stack audit follow-up: authenticated live QA and GitHub/product issue workflow

## Audit context

Codex ran a multi-agent frontend/backend/UI/AI/Firebase audit on June 28, 2026.

## Fixed locally in this audit

- Added a trusted `createNotification` Firebase Function and moved cross-user notification creation through it.
- Locked RTDB `notifications/{uid}` so clients can read/remove their own notifications but cannot create arbitrary notification rows for themselves or other users.
- Added notification rate limiting and relationship validation for supported server-created notification types: mentions, kudos, friend requests, and room join notices.
- Added deployed authenticated smoke coverage for the trusted notification endpoint with a second disposable user.
- Added a reusable `npm run audit:deployed` smoke script covering disposable Auth users, Global Chat write, private room create/write, AI gateway status, trusted notifications, issue queue, and exact cleanup.
- Made live AI/chat/photo bridge responses verify `X-Minimalist-Ollama-Bridge: 1`, not just the status probe.
- Expanded the AI abuse scan to the full sanitized inference window instead of only the latest four messages.
- Aligned AI gateway status fallback behavior with the real inference path when Groq fallback is explicitly enabled.
- Fixed Calendar photo import gateway detection to use resolved runtime config, including `window.AI_CALENDAR_ENDPOINT`.
- Made Calendar photo prep reject images that remain too large after compression instead of uploading an oversized final payload.
- Made reaction/menu placement safe-area aware on mobile and tablet viewports.
- Removed the older absolute-position message action rail CSS so reaction/actions stay inside the selected bubble.
- Kept mobile catch-up context visible as one clamped line instead of hiding the text that powers the Task action.
- Moved mobile toast bottom spacing onto `--mobile-nav-clearance`/safe-area variables and kept auth inputs at `1rem` on small phones.
- Updated the hosted CSP so Google sign-in can load `apis.google.com` and the Google Identity stylesheet from `accounts.google.com`.
- Added an authenticated `submitIssueDraft` Firebase Function so `/feedback` queues sanitized, rate-limited issue drafts server-side instead of opening a `mailto:` link or asking the browser to write trusted support data.
- Added a token-gated GitHub issue publisher path: queued issue drafts can now be published server-side through `publishIssueDrafts` or the `publishIssueDraftToGithub` queue trigger when `GITHUB_ISSUE_TOKEN` is configured in the Functions runtime.
- Added App Check client/server plumbing for authenticated Firebase Function calls: the browser can send `X-Firebase-AppCheck` when `window.FIREBASE_APP_CHECK_SITE_KEY` is configured, Functions can enforce it with `REQUIRE_APP_CHECK=true`, and hosting CSP now allows the required reCAPTCHA assets.
- Updated deployed smoke testing so it can include `FIREBASE_APP_CHECK_TOKEN` when App Check enforcement is enabled.
- Added a dependency-free Chrome DevTools Protocol UI smoke test (`npm run audit:ui`) covering desktop/mobile public routes, signed-out chat redirects, Google sign-in button mount, mobile menu, nav clicks, horizontal overflow, crash overlays, and small primary controls.
- Scoped chat composer drafts and typing indicators by room plus channel, so multi-channel rooms no longer leak unsent text or typing status across channels.
- Kept room catch-up/digest available in read-only composer states so muted/read-only users can still recap the room.
- Hardened badge writes so users can self-award only the welcome badge; Founder is now awarded by a trusted backend room-create trigger.
- Made GitHub issue auto-publishing opt-in with `GITHUB_ISSUE_AUTO_PUBLISH=false` by default; issue submissions queue for review unless explicitly enabled or manually published by an admin.
- Hardened room webhooks with HTTPS-only validation, credential rejection, DNS/IP private-network blocking, and a 5-second server fetch timeout.
- Serialized structured issue metadata with JSON instead of flattening objects to `[object Object]`.
- Updated mobile/touch UI sizing for marketing drawer links, feature quick-nav chips, login Home pill, auth mode tabs, live-demo tool buttons, and password reveal controls.
- Updated PM mobile safe-area handling so its header and composer respect app-level top/bottom safe-area variables.
- Hardened shared room task validation so malformed task payloads, unknown fields, wrong creator IDs, oversized text, and invalid status/priority values are rejected by RTDB rules.
- Hardened shared room doc validation so malformed document payloads, unknown fields, wrong authors, and oversized document content are rejected by RTDB rules while collaborator presence remains supported.
- Hardened authenticated Cloud Functions against banned users by checking `users/{uid}/isBanned` before serving privileged function work.
- Hardened the Ollama gateway so malformed bridge JSON, empty bridge responses, and non-Minimalist bridge URLs fail closed instead of silently falling back to Groq.
- Added a protected bridge response marker and redeployed/restarted the bridge so deployed AI can verify it is talking to the Minimalist bridge, not a raw or spoofed endpoint.
- Reduced Calendar photo import payload size so the first valid Base-tier photo scan fits within the current Banana limits.
- Made AI room context loading bounded to the latest 120 messages and changed AI chat auto-scroll so it respects the user's scroll position.
- Repaired client bot/system writes so bot-style notices are owned by the requesting user instead of spoofing reserved bot UIDs that security rules reject.
- Made room index repair run on authenticated chat boot, not only when the local room index is entirely missing.
- Hardened local private-room invite fallback so localhost/self-join cannot bypass private-room membership checks.
- Added a 30-second PM push cooldown per sender/recipient pair to reduce notification spam.
- Added Android bottom safe-area fallback spacing and PM-specific notification copy.
- RTDB global and room message rules now make message bodies owner-only after creation, while keeping per-user reactions and poll votes writable.
- RTDB private-message rules now make PM message bodies create-only; read receipts remain writable only by the correct participant.
- RTDB inbox writes are now scoped to each user's own inbox, preventing arbitrary recipient inbox spam from client code.
- Added a deployed `pmInboxFanout` Cloud Function so private messages still populate both participants' inbox rows through trusted server code.
- AI gateway, Calendar photo import, and AI status probing no longer silently fall back to Groq when the protected Ollama bridge has auth/config/model errors.
- Calendar photo import now re-encodes uploads before vision processing and checks imported events against Google Calendar events to avoid duplicate entries.
- Calls now stop local microphone/camera/screen tracks immediately on leave/end and avoid ejecting the user when switching channels if the new join fails.
- Grouped notification writes now use RTDB transactions instead of read-modify-write races.
- Contacts, Vault share options, and profile skill-tree/profile metadata layout overrides were tightened for mobile/tablet alignment.
- `npm test` now runs lint, build, regression audit, and RTDB rules smoke tests instead of stopping at lint/build.
- RTDB room message rules now enforce global ban/mute, room mute, room chat permission, and member-specific chat overrides.
- RTDB room metadata rules now support delegated channel create/manage and webhook/bot management.
- Room settings UI now honors per-member channel/webhook overrides.
- AI gateway status now probes the protected Ollama bridge `/api/tags` and model availability instead of only reporting config.
- Server AI requests only use the protected Ollama bridge when both URL and token are configured; emergency Groq fallback can be used when explicitly enabled.
- Personal AI Banana charges are now refunded if profile/user loads fail before the model call.
- Calendar photo import status text distinguishes secure gateway mode from local Ollama mode.
- Mobile reaction/catch-up actions have larger tap targets, and the chat composer textarea auto-resizes.
- Discoverable/public room preview now exposes only safe room metadata fields to outsiders; sensitive members, logs, webhook, bots, and member permission data stay private.
- Room call rules now enforce server-side `video` and `screenShare` permission gates, including multi-channel calls.
- Chat composer drafts and attachments are no longer cleared until the authoritative message write succeeds.
- Chat live-window removals now verify the message was actually deleted before removing it from local history, avoiding gaps when messages age out of `limitToLast(30)`.
- Message jump history loading now reaches a terminal “not available” state instead of endlessly offering `Load older`.
- Marketing responsive CSS loads before deferred route styles, reducing cold-load desktop-nav flashes on phones.
- Phone app panels now reserve bottom-nav and safe-area clearance instead of covering the mobile navigation.
- Tablet marketing nav links now have touch-sized hit areas.
- Hidden toast placeholders no longer render as blank UI on first chat load.
- The service worker now keeps non-fingerprinted static CSS/JS in stale-while-revalidate cache between launches while still fetching navigations, `config.js`, and service-worker files fresh.
- AI gateway bridge-health failures are sanitized before reaching the browser; raw upstream HTML is no longer exposed in the error body.
- Composer Enter-to-send now ignores IME composition events so Japanese/Chinese/Korean text is not submitted mid-composition.
- Catch-up task creation and message reaction writes now report failures instead of silently dropping permission/network errors.
- Reaction writes are serialized per message/user to avoid rapid-tap races on mobile.
- Message action menus are fixed-position and viewport-clamped instead of using hard-coded page offsets.
- Mobile utility panels no longer double-apply top safe-area spacing, and Contacts action buttons now use 44px touch targets.
- The first-run onboarding mode chooser is now viewport-bounded on mobile, internally scrollable, and keeps its actions reachable.

## Verified locally

- `npm run audit:regression` passed with 104 checks after the final multi-agent hardening pass.
- `npm run audit:ui` passed locally against the production build and against `https://chat-app-356c1.web.app`.
- `npm run audit:rules` passed with Firebase Database emulator smoke tests, including delegated room permissions, discoverable-room privacy, call permission boundaries, message immutability, PM immutability, PM inbox write scoping, reactions, and poll votes.
- RTDB rules smoke now also covers valid room task/doc writes plus malformed task/doc denial, including unknown fields, wrong creator/author, and oversized doc content.
- `npm run lint` passed.
- `npm run build` passed: production build and marketing prerender.
- `npm test` passed end-to-end.
- `node --check functions/index.js`, `node --check tools/audit-regression-check.mjs`, and `node --check tools/rtdb-rules-smoke-test.mjs` passed.
- In-app browser smoke: desktop home, mobile login, and signed-out `/chat -> /login` redirect had no console errors, no crash overlay, and no horizontal overflow.
- Firebase deploy completed with Node 22.23.1: hosting, RTDB rules, and functions including `pmInboxFanout`.
- Production rules smoke passed with disposable users: owner message create allowed, another user message rewrite denied with `PERMISSION_DENIED`, another user reaction allowed, unauthenticated `aiGateway` returned `401`, and test rows were removed.
- Deployed browser smoke on `https://chat-app-356c1.web.app/`: desktop home, desktop login navigation, mobile login, and mobile `/chat -> /login` auth gate had no console errors, no crash overlay, and no horizontal overflow.
- Authenticated deployed UI smoke passed with a disposable verified account: Global Chat message send, private room creation, private room message send, mobile authenticated chat shell, and Contacts panel all loaded without crash overlays or horizontal overflow; test messages, room data, profile rows, invites, notifications, inbox data, and Auth user were removed afterward.
- Authenticated deployed AI status smoke now reaches the protected bridge successfully: `provider: ollama-bridge`, `model: llama3.1:latest`.
- Authenticated deployed AI prompt smoke returned `pong` from `llama3.1:latest` through the Firebase gateway and charged/reflected Bananas correctly; disposable data was removed afterward.
- Authenticated deployed Calendar photo extraction smoke used `qwen2.5vl:7b` through the protected bridge and returned only the real work shift from a test image while ignoring a visible `No Shift` day-off row.
- The protected local bridge and Cloudflare tunnel were restarted after deploy and verified healthy with `BridgeControl.ps1 -SelfTest`.
- The deployed `submitIssueDraft` Function was smoke-tested with a disposable Firebase Auth user, returned a queued issue id, and the exact test queue/rate rows were removed afterward.
- `npm run audit:deployed` passed against production after deploy: two disposable users, Global Chat write, Global Chat channel typing write, private room create/write, private room channel typing write, AI gateway status, trusted notification endpoint, issue draft queue, and exact cleanup.
- The protected bridge was restarted after the marker hardening; `/api/tags` and `/health` now return `X-Minimalist-Ollama-Bridge: 1` locally and through the configured Cloudflare tunnel.
- The deployed `aiGateway` status endpoint was smoke-tested with a disposable Firebase Auth user after the bridge restart and returned `provider: ollama-bridge`, `model: llama3.1:latest`, `tier: free`.
- Local Chrome smoke on `http://127.0.0.1:5174/login` passed on desktop and Pixel-sized mobile without console errors or crash overlays; unauthenticated `/chat` redirected to `/login` cleanly.
- Deployed Chrome smoke on `https://chat-app-356c1.web.app/login` now has no Google Identity CSP console errors; the Google button iframe renders in `.google-identity-button`.
- Firebase deploy completed with Node 22 after the App Check hardening pass: Functions and hosting were updated with App Check support/CSP changes; `createNotification`, `publishIssueDrafts`, and `publishIssueDraftToGithub` remain live.
- `npm run audit:deployed` passed against production after the App Check deploy: two disposable users, Global Chat write, private room create/write, AI gateway status, trusted notification endpoint, issue draft queue, and exact cleanup.
- Rendered in-app browser smoke on `http://127.0.0.1:5174/chat` with a disposable verified account showed mobile chat and Contacts panel without horizontal overflow; hidden toast stayed hidden. The smoke exposed a short-viewport onboarding modal issue, which was fixed afterward.
- Hosted asset smoke confirmed deployed `features.css` contains the fixed-position message menu, 44px Contacts action buttons, safe-area dedupe, and viewport-bounded onboarding modal; deployed `chatApp-jZrJQczu.js` contains the IME guard plus task/reaction failure handling.

## Remaining gaps / blockers

- The protected Ollama bridge is healthy now, but public AI depends on this PC keeping Ollama, the bridge process, and the Cloudflare tunnel running. If the deploy runner or Windows closes the bridge, deployed AI will return bridge-health errors again until the bridge is restarted.
- Signed-in Vault, Calls, Calendar photo import, and full multi-user call/video flows still need hands-on device QA because they require camera/microphone/storage prompts and real browser/device permissions.
- GitHub connector issue creation failed with `403 Resource not accessible by integration` for `Hao14/minimalist-chat`, the local `gh` CLI is not installed, and Chrome automation was blocked by an open extension UI while trying to use the logged-in browser.
- The in-app issue workflow now queues trusted drafts and has a deployed publisher path, but real GitHub issue creation still requires configuring `GITHUB_ISSUE_TOKEN` plus `GITHUB_ISSUE_OWNER`/`GITHUB_ISSUE_REPO` if the defaults are not correct.
- Firebase App Check support is wired but enforcement is intentionally off until a real Web App Check site key is configured in `public/config.js` and `REQUIRE_APP_CHECK=true` is enabled after a smoke test with an App Check token.
- Fully closed-app Android push and real camera/microphone permission prompts still require native/real-device QA.

## Suggested next step

Use a real signed-in device/session to run final hardware/browser QA on:

- Channel create/delete with delegated permissions
- Webhook/bot settings with delegated permissions
- Calls, camera, microphone, screen share, Android notification permission, and push notification delivery
