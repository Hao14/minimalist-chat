---
title: Site-wide Performance Optimization 2026-07-15
status: current
verified_on: 2026-07-15
tags:
  - minimalist-chat
  - audit
  - performance
  - long-session
---

# Site-wide Performance Optimization 2026-07-15

## Outcome

The local production build now has enforceable route budgets, bounded long-session chat state, repeat-open-safe feature mounting, lifecycle-paused room features, lighter signed-in startup work, resilient service-worker caching, and client-side image preparation before Storage uploads.

The signed-in `chatApp` startup chunk is 124.39 KiB gzip. The complete signed-in chat core is 314.1 KiB gzip against a 330 KiB budget.

## Long-session guardrails

- Active live chat trims passively accumulated messages and has a 600-message hard ceiling; inactive cached scopes retain at most 240 messages across an eight-scope LRU.
- Room sidebars stream only authorization plus the live `name`, `shortId`, `photoUrl`, and `lastMessage` summary fields instead of every room's complete metadata tree.
- Hidden Docs, Tasks, Events, Home, Whiteboard, Calendar, and AI views release or pause Firebase listeners, timers, handlers, polling, and active AI requests. Room changes unmount and rescope those views.
- Presence, notification, PM inbox, profile, and cosmetic background services are account-aware, idempotent, bounded, and visibility-aware.
- PM messaging reuses the shared inbox stream and keeps call setup cancellable across close, account, and conversation changes.
- Still-image uploads are resized/re-encoded for their display role; animated or unsupported assets retain the original safe fallback.

## Repeat-open lifecycle guardrails

- Feature mounts coalesce same-context imports, ignore stale async completions, reuse the current React root, and replace or unmount roots when the chat host changes.
- A room change immediately scopes only the default visible view. Previously visited hidden tabs no longer all rerender or refetch whenever the room changes.
- Data-heavy Home, Docs, Tasks, Events, Calendar, and Whiteboard subscriptions stay warm for a 12-second quick-revisit window and then pause. Presence, editors, active AI requests, and call continuity keep their stricter immediate lifecycle rules.
- Room AI context uses a bounded 15-second single-flight cache. PM sessions and inbox rows, public-profile social reads, and GitHub updates use bounded or time-limited caches so repeated opens cannot grow memory or request volume without limit.
- Search, Quests, Updates, Contacts, private messages, Vault, Personal Agent, and notification surfaces now close semantically, cancel pending work, and avoid rendering while hidden.
- Generated `.codex-temp` build artifacts are excluded from lint so local QA output cannot create false source failures.

## Delivery guardrails

- `npm run build` now fails when route JavaScript, signed-in JavaScript/CSS, the largest chunk, or entry HTML exceed explicit gzip budgets.
- Intent preloading skips Save-Data, constrained connections, hidden pages, and low-memory devices.
- Service-worker cache writes are best effort and cannot discard a valid network response; navigation preload and bounded runtime-cache pruning remain enabled.

## Verification snapshot

Chrome DevTools production-preview traces:

| Scenario | LCP | CLS | Conditions |
|---|---:|---:|---|
| Home desktop | 555 ms | 0.00 | 1280 × 720, 1× CPU, no network throttle |
| Home phone | 1,715 ms | 0.00 | 390 × 844, 4× CPU, Slow 4G |
| Login phone | 1,510 ms | 0.00 | 390 × 844, 4× CPU, Slow 4G |

The throttled preview traces include about 581–587 ms of synthetic network TTFB and should not be compared directly with differently throttled historical runs.

Verification also passed the complete `npm test` pipeline, 248 regression assertions, 10 focused lifecycle/cache tests, 22 desktop/mobile UI route checks, and 14/14 scripted interactions with no horizontal overflow or warnings. A signed-in repeat-open spot check completed 15 Home/Docs cycles and 15 Vault cycles with stable DOM counts and no console warnings or errors. A later broader signed-in browser rerun was interrupted by the local browser harness after the authenticated shell loaded, so the automated lifecycle, regression, build, and UI suites are the final verification authority for this pass. No deployment was performed.

## Canonical sources

- `src/features/chat-core/ChatCore.jsx`
- `src/features/shell/chatApp.js`
- `src/features/shell/roomTabActivity.js`
- `src/features/shell/featureMountCoordinator.js`
- `src/features/shell/hostAwareRoot.js`
- `src/features/private-messages/PrivateMessages.jsx`
- `src/features/ai/AI.jsx`
- `src/features/community/timedSingleFlightCache.js`
- `src/lib/imageUploadOptimization.js`
- `public/sw.js`
- `tools/check-performance-budgets.mjs`
- `tools/feature-mount-coordinator.test.mjs`
- `tools/audit-regression-check.mjs`

Related history: [[30 Audits/Lighthouse History|Lighthouse History]].
