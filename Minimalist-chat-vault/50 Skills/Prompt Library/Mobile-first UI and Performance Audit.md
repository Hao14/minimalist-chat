---
title: "Mobile-first UI and Performance Audit Prompt"
source_kind: markdown
source_path: "reports/claude-mobile-first-ui-performance-audit-prompt.md"
source_sha256: 2fa8360d0cca3ab3750632a71b7bfddd16c6e623f94f077a983fe0f1ad201af8
imported_on: 2026-07-14
status: reusable
tags:
  - minimalist-chat
  - skill
  - prompt
  - audit
  - mobile
---

> [!info] Additive import
> Source: `reports/claude-mobile-first-ui-performance-audit-prompt.md` · SHA-256: `2fa8360d0cca…`

# Claude Opus High-Effort Mobile-First UI/Performance Audit Prompt

You are Claude Opus running as an external senior product engineer, frontend performance auditor, and mobile UX reviewer for the local project `minimalist-chat`.

Work read-only. Do not edit files. Do not write code changes. Do not deploy. Your output must be a diagnosis and an implementation prompt for Codex to execute.

Project context:
- Workspace: `C:\Users\jaysa\Documents\minimalist-chat`
- App: React 19 + Vite 6 PWA using Firebase Auth/Realtime Database/Storage/Messaging, Capacitor Android, Express/server utilities, and Firebase Hosting.
- Local app usually runs at `http://localhost:5173`.
- User reports many broken UI elements, especially on mobile and tablet.
- Recent known areas of concern:
  - Mobile UI alignment and clipped/overflowing text.
  - Chat message reaction/action menu layout.
  - Room tabs and side panels.
  - AI tab scroll/performance.
  - Contacts/Vault mobile loading delay.
  - Google sign-in/mobile auth reliability.
  - Calls tab mobile permissions and call UI.
  - Android safe-area/top inset handling.
  - Marketing/home page mobile-first responsive polish.
  - Overall mobile-first performance and optimization.

Audit goals:
1. Scan the whole app structure and identify likely UI/UX breakpoints.
2. Diagnose mobile-first layout, accessibility, performance, and interaction risks.
3. Prioritize issues that are user-visible, crash-prone, or likely to cause permission/auth failure.
4. Identify specific files/components/CSS selectors to inspect or change.
5. Produce a concise but complete "Prompt for Codex" that Codex can execute next.

Recommended inspection path:
- Read `package.json`, `src/App.jsx`, `src/pages/ChatPage.jsx`, `src/pages/LoginPage.jsx`, `src/pages/MarketingPages.jsx`.
- Inspect shell/navigation and boot logic under `src/features/shell/`.
- Inspect high-risk feature components:
  - `src/features/chat-core/ChatCore.jsx`
  - `src/features/ai/AI.jsx`
  - `src/features/calls/Calls.jsx`
  - `src/features/contacts/ContactsList.jsx`
  - `src/features/vault/Vault.jsx`
  - `src/features/private-messages/PrivateMessages.jsx`
  - `src/features/profile/ProfilePopupSections.jsx`
  - `src/features/calendar/Calendar.jsx`
  - `src/features/tasks/Tasks.jsx`
  - `src/features/search/Search.jsx`
- Inspect primary CSS:
  - `public/base.css`
  - `public/mobile.css`
  - `public/features.css`
  - `public/themes/codex.css`
  - `public/themes/modern.css`
- If safe, run read-only/verification commands such as:
  - `npm test`
  - `npm run build`
  - targeted `rg` searches
  - optional browser-based or static analysis only if available.

Do not include secrets, tokens, credentials, or private user data in your response.

Output format:

## Executive Summary
Give the top 5 highest-impact findings.

## Diagnosed Risks
List concrete UI/UX/performance/auth risks. Include file paths and selectors/functions where possible.

## Mobile-First Optimization Plan
Give an ordered plan for mobile-first performance and UI hardening. Focus on changes Codex can safely implement.

## Prompt for Codex
Write a direct implementation prompt addressed to Codex. The prompt should:
- tell Codex exactly what to fix first,
- include priority order,
- include file paths/selectors/components,
- include verification steps,
- tell Codex to keep edits scoped and avoid reverting existing work,
- tell Codex to run tests and browser checks.

## Optional Feature Opportunities
Suggest only features that improve speed, clarity, reliability, or mobile usability.
