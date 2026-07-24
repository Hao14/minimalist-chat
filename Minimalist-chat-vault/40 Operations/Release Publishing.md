---
title: Release Publishing
status: active
updated_on: 2026-07-23
tags:
  - minimalist-chat
  - operations
  - release
  - deployment
  - build-number
---

# Release Publishing

## Invariant

Every Firebase Hosting publish must create a new visible build number, including a republish of identical source. [Source: User, build-number publishing requirement, 2026-07-23]

Functions-, database-, rules-, or Storage-only deployments do not replace the hosted web application and therefore do not create a new web build number. [Source: `firebase.json`; `tools/deploy-firebase-hourly.ps1`]

## Two release identities

- The **publish build number** identifies one Hosting publication. It begins with a UTC millisecond timestamp, includes a random nonce, and ends with a short source revision; Vite exposes it in Settings, bootstrap asset URLs, the service-worker version, and `dist/build-info.json`. [Source: `tools/publish-build-number.mjs`; `vite.config.js`; `src/lib/buildInfo.js`; `src/main.jsx`; `tools/prepare-hosting-publish.mjs`]
- The **RUM source release** identifies the stable source state used for real-user performance comparisons. Republishing identical source changes the visible publish build number without resetting the source-level performance cohort, and every build path uses the same shared source-fingerprint implementation. [Source: `tools/source-release-id.mjs`; `vite.config.js`; `src/features/performance/realUserPerformance.js`; `tools/prepare-hosting-publish.mjs`]

## Guarded workflow

1. Prefer `npm run deploy` for the normal guarded Firebase release or `npm run deploy:force` only when intentionally overriding the hourly source-change skip. [Source: `package.json`; `tools/deploy-firebase-hourly.ps1`]
2. Every Hosting path enters the same Firebase `predeploy` hook; the hook runs the required RUM gate, allocates one fresh build number, atomically publishes a complete cross-publisher lifecycle-lock state, and creates a new production build. Reusable environment flags and old `dist` output are not accepted as proof of freshness. [Source: `firebase.json`; `tools/prepare-hosting-publish.mjs`; `tools/rum-performance-gate.mjs`]
3. The guarded publisher rejects `-SkipBuild` for `hosting` and `hosting:<target>` selections, while direct `firebase deploy --only hosting` receives the same guarded build automatically. [Source: `tools/deploy-firebase-hourly.ps1`; `tools/prepare-hosting-publish.mjs`]
4. Vite emits `dist/build-info.json` from the same build constants compiled into Settings and service-worker startup. The predeploy hook then verifies the exact `load-css.js` and `config.js` build URLs, Vite manifest, public identity metadata, and compiled consumers before Firebase can upload `dist`. [Source: `vite.config.js`; `tools/prepare-hosting-publish.mjs`; `src/lib/buildInfo.js`; `src/main.jsx`]
5. The Hosting `postdeploy` hook reads the immutable active-publish state, checks the local artifact again, fetches and parses the cache-busted target metadata within one bounded request deadline, requires exact build/version/source metadata, and releases the lifecycle lock in `finally`. [Source: `firebase.json`; `tools/verify-hosting-publish.mjs`; `tools/prepare-hosting-publish.mjs`]
6. The Stripe billing deployment uses the same common hook and the repository's bundled Node 22 runtime for owner-scoped cleanup if Firebase stops before postdeploy. [Source: `tools/deploy-stripe-billing.ps1`; `tools/firebase-node22.ps1`; `tools/prepare-hosting-publish.mjs`]
7. Firebase `--dry-run` ancestry is detected by the common hook; it still validates a fresh production artifact, then releases the lifecycle lock because Firebase intentionally skips postdeploy during a dry run. [Source: `tools/prepare-hosting-publish.mjs`; `tools/publish-build-number.test.mjs`]
8. If an unwrapped direct Firebase command ends after predeploy but before postdeploy, use the exact build-scoped recovery command printed by the next attempt: `node tools/prepare-hosting-publish.mjs --cleanup-build <build-number>`. A legacy invalid lock can be removed with `node tools/prepare-hosting-publish.mjs --cleanup-corrupt-lock`, which refuses to delete valid lock state. Automatic age-based lock deletion is forbidden because it could unlock a legitimate long-running publish. [Source: `tools/prepare-hosting-publish.mjs`]
9. Preview-channel verification must set `MINIMALIST_HOSTING_VERIFY_ORIGIN` to that channel's HTTPS origin so postdeploy checks the channel rather than the production origin. [Source: `tools/prepare-hosting-publish.mjs`; `tools/verify-hosting-publish.mjs`]

## Verification contract

Release tests require unique publish numbers for repeated identical source, one identifier across exact bootstrap URLs, Vite identity and compiled consumers, Windows-safe npm execution, complete atomic lock publication, safe corrupt-lock recovery, Firebase dry-run cleanup, one collision-resistant shared RUM source identity, bounded live header/body verification, owner-scoped cleanup, and guarded coverage of every repository Hosting path. [Source: `tools/publish-build-number.test.mjs`; `tools/performance-rum.test.mjs`; `tools/audit-regression-check.mjs`]

This record describes a local implementation and operating rule; no Hosting deployment was performed while establishing it. [Source: Codex implementation session, 2026-07-23]
