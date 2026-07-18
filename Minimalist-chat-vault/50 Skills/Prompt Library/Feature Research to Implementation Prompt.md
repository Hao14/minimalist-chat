---
title: "Feature Research to Implementation Prompt"
source_kind: markdown
source_path: "reports/claude-opus-4-6-feature-research-request.md"
source_sha256: 7decb9e8e200ed5fb816f8d8d2d399d0578a81c15f45d82cb25d5ff98853d625
imported_on: 2026-07-14
status: reusable
tags:
  - minimalist-chat
  - skill
  - prompt
  - research
---

> [!info] Additive import
> Source: `reports/claude-opus-4-6-feature-research-request.md` · SHA-256: `7decb9e8e200…`

# Claude Opus 4.6 Max-Effort Request: Feature Research To GPT Implementation Prompt

You are Claude Code running in `C:\Users\jaysa\Documents\minimalist-chat`.

Requested model/effort from the user: Claude Opus 4.6, max effort. If the CLI model alias maps to a newer or different Opus model, state the actual model/alias available in your output.

## Mission

Research respected chat, collaboration, and community apps, compare them against Minimalist Chat, then return a self-contained implementation prompt that GPT/Codex can execute in this repo.

Do not edit files.
Do not deploy.
Do not create commits or PRs.
Do not ask the user questions.
Use the repo and web research if tools are available.

## Current Product Context

Minimalist Chat is a React 19 + Vite 6 PWA with Firebase Auth, Realtime Database, Storage, Functions, and Hosting. The app includes rooms, channels, chat, docs, whiteboard, tasks, events/calendar, calls, AI/Ollama bridge, vault, contacts, themes, Android/PWA support, and Firebase deploy tooling.

Recent user priorities:

- Mobile-first and tablet-first quality.
- Chat reliability, especially Global Chat permission errors.
- Better reaction menu/action rail layout.
- More compact catch-up/quick digest UI.
- Faster boot and smoother asset loading.
- Better calls tab with multi-channel call behavior.
- Better AI tab and safe Ollama bridge behavior.
- Android notification support and app-like behavior.
- UI alignment, text clipping, broken buttons, and visual polish.
- Competitive features that improve real use without bloating the app.

## Competitor Research Targets

Research official/current references when possible:

- Discord: servers, channels, stage channels, voice/video/community workflows, moderation, onboarding.
- Slack: huddles, clips, canvas, channel workflows, search, reminders, threads, mobile app ergonomics.
- Telegram: folders, channels, saved messages, bots, broadcast/community patterns, mobile speed.
- WhatsApp/Signal: privacy expectations, simple mobile messaging, notifications, media behavior.
- Element/Matrix: rooms/spaces, self-hosting, trust/safety, privacy language.
- Microsoft Teams/Google Chat: meetings, threaded conversations, productivity integrations.
- Notion/Linear/GitHub Discussions as secondary inspiration for docs/tasks/issues/workflows.

## Output Requirements

Return one Markdown document only. It must be directly usable by GPT/Codex as an implementation prompt.

Structure your response exactly like this:

1. `# Claude Research Result: Minimalist Chat Feature Implementation Prompt`
2. `## Model And Research Notes`
   - State model alias/name used.
   - State whether web research was available.
   - Include 8-14 source links that informed the recommendations.
3. `## Competitive Findings`
   - What Minimalist Chat already does well.
   - Where competitors are clearly stronger.
   - What not to copy because it adds privacy, security, cost, or complexity risk.
4. `## Highest-Impact Feature Opportunities`
   - Prioritized table with feature, inspiration, user impact, implementation effort, risk, and why now.
5. `## GPT/Codex Implementation Prompt`
   - Write a full prompt for GPT/Codex to execute.
   - The prompt must include target files or likely file areas.
   - The prompt must be scoped to safe local implementation, not deployment.
   - The prompt must tell GPT/Codex to preserve unrelated dirty work.
   - The prompt must require tests/build/audit checks.
6. `## Recommended Implementation Scope For First Pass`
   - Pick 3-5 concrete features/fixes only.
   - Prefer mobile-first improvements and existing-data-model changes.
   - Include acceptance criteria.
7. `## Defer`
   - List features to defer and why.

## Feature Bias

Prefer features that:

- Make chat feel faster and more usable on phone/tablet.
- Reduce repeated reload/wait states.
- Improve navigation between rooms/channels.
- Improve meetings/calls without requiring a new media backend.
- Improve AI usability and explain "Bananas" usage limits clearly.
- Improve safety/privacy posture without making false security claims.
- Use existing Firebase data paths when possible.
- Do not add new paid services.

Avoid:

- New dependency sprawl.
- Broad rewrites.
- Claims of end-to-end encryption unless implemented.
- Desktop-only features.
- Marketing-only redesign with no product value.
- Features that require users to read long in-app explanations.

## Verification Expectations For GPT/Codex

The implementation prompt should require:

```powershell
npm run lint
npm run audit:regression
npm run build
```

If browser testing is available, require mobile `390x844`, tablet `820x1180`, and desktop `1280x720` checks for `/`, `/login`, and `/chat`.
