---
title: "Performance, Error, and Bug Audit Prompt"
source_kind: markdown
source_path: "reports/opus-4-6-max-effort-audit-to-gpt-prompt.md"
source_sha256: 406d5d6e19f183dd92ac0013e7541b1abd493ce73c08f67a26070176440eb9fe
imported_on: 2026-07-14
status: reusable
tags:
  - minimalist-chat
  - skill
  - prompt
  - audit
---

> [!info] Additive import
> Source: `reports/opus-4-6-max-effort-audit-to-gpt-prompt.md` · SHA-256: `406d5d6e19f1…`

# Minimalist.chat Performance, Error, and Bug Audit Execution Prompt

Use this prompt with GPT or Claude Opus in high/max effort mode.

## Context

You are working on `C:\Users\jaysa\Documents\minimalist-chat`.

Stack:
- React 19 + Vite 6 PWA
- Firebase Auth, Realtime Database, Storage, Functions
- Node 22 required for deploy/build tooling
- Main app route: `http://localhost:5173/chat`
- Marketing route: `http://localhost:5173/`

The repo may already have many dirty changes. Do not revert user or previous-agent work. Keep edits scoped, test each change, and explain every fix.

## Important Scan Results Already Collected

Commands run:

```powershell
npm run lint
npm run build
```

Results:
- `npm run lint` passed.
- `npm run build` passed.
- Vite built in about 1.43s and prerendered 8 routes.

Largest production chunks from the build:
- `vendor-firebase-startup-*.js`: 438.90 kB, gzip 92.54 kB
- `chatApp-*.js`: 337.00 kB, gzip 99.32 kB
- `vendor-react-*.js`: 231.25 kB, gzip 73.91 kB
- `ChatPage-*.js`: 78.72 kB, gzip 15.19 kB
- `MarketingPages-*.js`: 50.83 kB, gzip 15.66 kB
- `vendor-firebase-storage-*.js`: 51.21 kB, gzip 12.20 kB
- `vendor-firebase-messaging-*.js`: 37.82 kB, gzip 6.92 kB

Browser scan:
- Routes tested: `/`, `/login`, `/chat`
- Viewports tested: desktop `1280x720`, mobile `390x844`
- `/` had no console errors.
- `/chat` had no console errors after boot.
- `/chat` can show the boot loader after about 1s, but it cleared after an extended wait of about 6.5s in the signed-in browser session.
- `/login` redirected to `/chat` in the signed-in browser session. Logged-out login still needs a clean-session test.
- No page-level horizontal overflow was detected, but mobile home has a decorative `.idemo-glow` element extending beyond the viewport inside a clipped container.
- Several mobile touch targets are under 44px high, especially marketing nav/demo/footer controls.

## Priority Bugs And Risks To Fix

### 1. Global Chat `PERMISSION_DENIED` when sending

User-reported issue: Global Chat sometimes fails with `PERMISSION_DENIED: Permission denied`.

Known code path:
- `src/features/chat-core/ChatCore.jsx`
- `roomMessagesRef(roomId, channelId)` lines around 276:

```js
function roomMessagesRef(roomId, channelId = 'general') {
  if (roomId === 'global') return ref(db, 'messages');
  if (!channelId || channelId === 'general') return ref(db, `rooms_data/${roomId}/messages`);
  return ref(db, `rooms_data/${roomId}/channels/${channelId}/messages`);
}
```

- `handleSubmit` lines around 3688-3854 writes:

```js
const newMessageRef = push(roomMessagesRef(activeId, activeChannelRef.current));
await set(newMessageRef, payload);
```

Current `database.rules.json` appears to allow authenticated writes to root `messages` when the user is not banned or muted:

```json
"messages": {
  ".read": "auth != null && (auth.uid === 'WsREhwYvPxaCSAjz0aqvwAU1leg2' || root.child('users').child(auth.uid).child('isBanned').val() !== true)",
  ".write": "auth != null && (auth.uid === 'WsREhwYvPxaCSAjz0aqvwAU1leg2' || (root.child('users').child(auth.uid).child('isBanned').val() !== true && root.child('users').child(auth.uid).child('isMuted').val() !== true))"
}
```

Execution:
- Reproduce in the browser only if explicitly allowed to post a test message, because sending a message is a side effect.
- Prefer using the Firebase Emulator or rules simulator if available.
- Verify deployed Realtime Database rules match local `database.rules.json`.
- Check whether the current user has `users/{uid}/isBanned` or `users/{uid}/isMuted` missing/true unexpectedly.
- Check whether the app ever routes Global Chat messages to `rooms_data/global/...` or a non-general channel by mistake.
- Add diagnostic logging around send failure that logs non-sensitive fields only: active room id, channel id, resolved DB path category, auth uid present, and Firebase error code. Do not log message text or tokens.
- Fix the root cause, not only the toast.

Acceptance:
- Authenticated, non-muted user can send to Global Chat.
- Muted/banned users are still blocked.
- Private-room permissions continue to work.
- Failure toast is specific and human-readable.

### 2. Reaction menu and message action rail layout

User-reported issue: reaction/action menu is no longer always visible, which is good, but when it appears it can cover or sit in front of messages.

Relevant files:
- `src/features/chat-core/ChatCore.jsx`
- `public/features.css`

Key component:
- `MessageItem` renders `.msg-actions` around line 1700.

CSS conflict zones:
- `public/features.css` around 9577-9635: `.msg-actions` absolute above bubble
- around 10000-10022: another touch override
- around 10129-10175: another absolute/mobile override
- around 20655-20690: `z-index: 4200` and more compact sizing
- around 20820-20905: final static override intended to stop overlap

Execution:
- Consolidate `.msg-actions` into one coherent model.
- Prefer keeping the action rail inside the message bubble flow or directly below the selected bubble on mobile/coarse pointers.
- Avoid huge z-index values unless the rail is a real overlay.
- Ensure inactive action rails have `opacity: 0`, `visibility: hidden`, and `pointer-events: none`.
- On hover/focus/touch active state, show only the selected message action rail.
- On mobile, do not place the rail above neighboring messages or the composer.
- Keep hit targets usable, ideally 36-40px minimum for compact message actions and 44px for primary controls.

Acceptance:
- Desktop hover: rail appears for the hovered/focused message only.
- Mobile tap/focus: rail appears for the selected message only.
- Rail does not cover previous/next message text.
- Rail does not overlap composer, quick replies, or catch-up strip.
- No horizontal page scroll.

### 3. Quick Digest / Room Catch-up consumes too much chat space

User-reported issue: Quick Digest/Catch-up area takes too much vertical space and makes the chat feel cramped.

Relevant code:
- `src/features/chat-core/ChatCore.jsx`, `RoomCatchUpStrip` around line 1325
- `public/features.css`, `.room-catchup-strip` around 9485 and 20685

Execution:
- Make the strip compact by default.
- Consider one-line summary with action buttons grouped tightly.
- Add collapse/dismiss behavior if state already exists, or a lightweight localStorage preference if not.
- Make mobile version shorter than desktop, not taller.
- Do not hide useful context completely unless dismissed.

Acceptance:
- On mobile, the catch-up strip should be no more than one compact band unless expanded.
- The composer and latest messages remain visible.
- Buttons stay readable and tappable.

### 4. Chat boot/loading timing

User had asked for loading to wait for assets because UI appeared before assets finished loading. Current scan shows `/chat` still displaying loader after about 1s and clearing after about 6.5s in one signed-in session.

Relevant files:
- `src/features/shell/chatBoot.js`
- `src/pages/ChatPage.jsx`

Constants:
- `MAX_BOOT_ANIMATION_MS = 1700`
- `BOOT_TASK_TIMEOUT_MS = 900`
- `REPEAT_BOOT_MIN_MS = 900`

Execution:
- Keep a polished boot screen, but do not mask real app stalls.
- Measure time to loader hidden and time to first usable chat controls.
- Add a fallback if auth/runtime stalls: clear loader to an actionable login/error state instead of infinite "waiting for auth".
- Avoid importing heavy feature modules before the shell is interactive.
- Confirm logged-out users see login promptly instead of a chat boot loop.

Acceptance:
- Signed-in `/chat` becomes interactive reliably.
- Logged-out `/chat` redirects/shows login reliably.
- Loader does not disappear before critical CSS/icons/fonts are ready.
- Loader does not stay up indefinitely.

### 5. Mobile marketing and touch-target polish

Scan findings:
- Home page mobile had no page-level horizontal overflow, but `.idemo-glow` extended past the viewport.
- Several touch targets are below the recommended 44px height:
  - marketing nav/logo/menu elements
  - live demo action buttons (`Pin`, `Task`, `Memory`, `Poll`, `Invite`)
  - footer links

Relevant files:
- `src/pages/MarketingPages.jsx`
- `src/features/shell/MarketingNav.jsx`
- `public/features.css`
- `public/mobile.css`

Execution:
- Clip or resize decorative overflow so it cannot create visual glitches.
- Increase tap target height/spacing on mobile without making the page bulky.
- Verify nav does not overlap Android/browser top chrome.
- Use `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` where fixed/sticky UI touches edges.

Acceptance:
- Mobile viewport `390x844` has no horizontal scroll and no clipped text.
- Primary controls are comfortably tappable.
- Sign-up/open-app button style remains modern and aligned.

### 6. Bundle and runtime performance

Build shows the largest chunks are Firebase startup, chatApp, React vendor, and ChatPage.

Execution:
- Audit eager imports in `src/features/shell/chatApp.js` and `src/pages/ChatPage.jsx`.
- Lazy-load Firebase Storage only when attaching/uploading files.
- Lazy-load Firebase Messaging only when enabling notifications or opening notification flows.
- Keep contacts, vault, AI, calls, docs, whiteboard, search, and room pages lazy-loaded unless required at first paint.
- Inspect whether `chatApp.js` imports feature modules that already have mount loaders.
- Do not split so aggressively that normal navigation flickers.

Acceptance:
- Production build still passes.
- Initial chat route loads less JS before interactivity.
- Contacts/Vault/AI still mount correctly when opened.
- No console errors from dynamic import race conditions.

### 7. CSS architecture risk

`public/features.css` is very large and contains repeated late overrides with `!important`. This is causing regressions like reaction rail conflicts.

Execution:
- Do not add another random override at the end unless it is a temporary surgical fix.
- For touched surfaces, consolidate into one local section with comments.
- Remove or neutralize obsolete conflicting blocks when safe.
- Keep theme-specific styles intact.

Acceptance:
- Reaction/catch-up/composer CSS has a single obvious source of truth.
- No new regressions across light/codex/dark/modern if those modes exist.

## Required Test Plan

Run:

```powershell
npm run lint
npm run build
```

Browser QA:
- Desktop `1280x720`
  - `/`
  - `/login` signed-out if possible
  - `/chat` signed-in
- Mobile `390x844`
  - `/`
  - `/login` signed-out if possible
  - `/chat` signed-in

Checks:
- No console errors or framework overlays.
- No horizontal scroll.
- Chat boot clears into a usable state.
- Message action rail appears only on target message and does not overlap messages/composer.
- Catch-up strip is compact and does not crowd chat.
- Global Chat send works for authenticated, non-muted user. Use emulator or ask before posting a real test message.
- Firebase rules remain secure.

## Deliverable

Implement the fixes in code. Then provide:
- Files changed
- Bugs fixed
- Performance improvements made
- Tests run and results
- Any remaining risks or manual checks needed

Do not deploy unless explicitly asked after the fixes are verified locally.
